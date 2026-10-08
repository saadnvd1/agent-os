import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlManager, type ControlDeps } from "./control";

// A tmux -C client that the test speaks for.
function fakeClient() {
  const child = new EventEmitter() as ChildProcess & {
    stdout: PassThrough;
    stdin: PassThrough;
    written: string[];
    say: (...lines: string[]) => void;
  };
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.written = [];
  child.stdin.on("data", (d) => child.written.push(String(d)));
  child.kill = vi.fn(() => {
    child.emit("exit", 0);
    return true;
  }) as never;
  child.say = (...lines) =>
    child.stdout.write(lines.map((l) => l + "\n").join(""));
  return child;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function manager(overrides: Partial<ControlDeps> = {}) {
  const clients: ReturnType<typeof fakeClient>[] = [];
  const pushed: string[] = [];
  const events: string[] = [];
  const m = new ControlManager({
    spawn: () => {
      const c = fakeClient();
      clients.push(c);
      return c;
    },
    feed: (name) => ({
      push: (d) => pushed.push(`${name}:${d}`),
      close: () => {},
    }),
    sessionsChanged: () => events.push("sessions-changed"),
    attached: (n) => events.push(`attached:${n}`),
    detached: (n) => events.push(`detached:${n}`),
    now: () => Date.now(),
    ...overrides,
  });
  return { m, clients, pushed, events };
}

// The client says which pane is active.
async function identify(c: ReturnType<typeof fakeClient>) {
  await tick();
  c.say("%begin 1 1 0", "%end 1 1 0"); // the attach's own block
  c.say("%begin 2 2 1", "%1", "%end 2 2 1");
  await tick();
}

// The first output starts a screen: pane info (the cursor after "world"),
// then the capture.
async function seed(c: ReturnType<typeof fakeClient>, capture: string[]) {
  await identify(c);
  c.say("%output %1 x");
  await tick();
  c.say("%begin 3 3 1", "%1 20 4 5 1", "%end 3 3 1");
  await tick();
  c.say("%begin 4 4 1", ...capture, "%end 4 4 1");
  await settle();
}

// The screen applies writes on a timer of its own.
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("ControlManager", () => {
  it("attaches read-only without changing size, seeds the screen, then follows output", async () => {
    const { m, clients, pushed, events } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    expect(events).toEqual(["attached:s1"]);
    await identify(c);
    // Nothing printed yet: no screen kept, the detector reads it the old way.
    expect(m.screen("s1")).toBeNull();
    await seed(c, ["hello", "world"]);
    expect(c.written.join("")).toContain("display-message -p -t =s1:");
    expect(c.written.join("")).toContain("capture-pane -e -p -t =s1:");
    expect(m.screen("s1")).toBe("hello\nworld");

    c.say("%output %1 more\\015\\012", "%output %9 other pane");
    await tick();
    expect(pushed).toEqual(["s1:x", "s1:more\r\n"]);
    expect(m.takeActivity()).toBe(true);
    expect(m.takeActivity()).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(m.screen("s1")).toBe("hello\nworldmore");
  });

  it("drops output that arrives before its capture's reply: the capture has it", async () => {
    const { m, clients } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    await identify(c);
    c.say("%output %1 first");
    await tick();
    c.say("%begin 3 3 1", "%1 20 4 0 0", "%end 3 3 1");
    await tick();
    c.say("%output %1 already-in-capture");
    c.say("%begin 4 4 1", "screen", "%end 4 4 1");
    await settle();
    expect(m.screen("s1")).toBe("screen");
  });

  it("says whether a pane printed since a time, once it knows the pane", async () => {
    let now = 1000;
    const { m, clients } = manager({ now: () => now });
    m.sync(["s1"]);
    const c = clients[0];
    expect(m.printedSince("s1", 0)).toBeNull();
    await identify(c);
    now = 2000;
    expect(m.printedSince("s1", 1500)).toBe(false);
    // From before it was watched, nothing can be promised.
    expect(m.printedSince("s1", 500)).toBeNull();
    c.say("%output %1 hi");
    await tick();
    expect(m.printedSince("s1", 1500)).toBe(true);
    expect(m.printedSince("s1", 2500)).toBe(false);
    c.emit("exit", 0);
    expect(m.printedSince("s1", 2500)).toBeNull();
  });

  it("applies output after a later capture's reply once, and none from before it", async () => {
    const { m, clients } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    await identify(c);
    c.say("%output %1 a");
    await tick();
    c.say("%begin 3 3 1", "%1 20 4 0 0", "%end 3 3 1");
    await tick();
    c.say("%begin 4 4 1", "first", "%end 4 4 1");
    await settle();
    expect(m.screen("s1")).toBe("first");
    // The window changed: once it's quiet, the screen is read again.
    c.say("%layout-change @1 x x *");
    await tick();
    c.say("%begin 5 5 1", "%1", "%end 5 5 1"); // identify
    await new Promise((r) => setTimeout(r, 2100));
    c.say("%begin 6 6 1", "%1 20 4 0 1", "%end 6 6 1");
    await tick();
    // Printed before the capture's reply ends: already in it.
    c.say("%output %1 IN-CAPTURE");
    c.say(
      "%begin 7 7 1",
      "first",
      "IN-CAPTURE",
      "%end 7 7 1",
      // Printed after it, in the same read: applied on top, once.
      "%output %1 \\015\\012after"
    );
    await settle();
    expect(m.screen("s1")).toBe("first\nIN-CAPTURE\nafter");
  });

  it("follows the active pane when it changes", async () => {
    const { m, clients, pushed } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    await identify(c);
    c.say("%window-pane-changed @1 %2");
    await tick();
    c.say("%begin 3 3 1", "%2", "%end 3 3 1");
    await tick();
    c.say("%output %1 old pane", "%output %2 new pane");
    await tick();
    expect(pushed.at(-1)).toBe("s1:new pane");
    expect(pushed).not.toContain("s1:old pane");
  });

  it("hands back nothing for a command tmux refused", async () => {
    const { m, clients } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    await identify(c);
    const answer = m.query("s1", "show-environment -t =s1 NOPE");
    await tick();
    c.say("%begin 7 7 1", "unknown variable: NOPE", "%error 7 7 1");
    expect(await answer).toBeNull();
  });

  it("ends a reply only at its own end, not a pane line that looks like one", async () => {
    const { m, clients } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    await identify(c);
    const answer = m.query("s1", "capture-pane -p -t =s1:");
    await tick();
    c.say(
      "%begin 8 8 1",
      "%end of a line on screen",
      "%end 1 1 1",
      "real",
      "%end 8 8 1"
    );
    expect(await answer).toEqual([
      "%end of a line on screen",
      "%end 1 1 1",
      "real",
    ]);
  });

  it("starts the client over when tmux doesn't answer, rather than mismatch replies", async () => {
    const { m, clients } = manager({ commandTimeoutMs: 30 });
    m.sync(["s1"]);
    const c = clients[0];
    const answer = m.query("s1", "display-message -p x");
    await new Promise((r) => setTimeout(r, 60));
    expect(c.kill).toHaveBeenCalled();
    expect(await answer).toBeNull();
  });

  it("answers tmux commands over the client, without a process", async () => {
    const { m, clients } = manager();
    m.sync(["s1"]);
    const c = clients[0];
    await identify(c);
    const answer = m.query("s1", "show-environment -t =s1 CLAUDE_SESSION_ID");
    await tick();
    c.say("%begin 5 5 1", "CLAUDE_SESSION_ID=abc", "%end 5 5 1");
    expect(await answer).toEqual(["CLAUDE_SESSION_ID=abc"]);
    expect(await m.query("nope", "x")).toBeNull();
  });

  it("says a session changed and lets go of sessions no longer wanted", async () => {
    const { m, clients, events } = manager();
    m.sync(["a", "b"]);
    clients[0].say("%sessions-changed");
    await tick();
    expect(events).toContain("sessions-changed");
    m.sync(["b"]);
    expect(clients[0].kill).toHaveBeenCalled();
    expect(events).toContain("detached:a");
    expect(m.watching("a")).toBe(false);
    expect(m.watching("b")).toBe(true);
  });

  it("starts an exited client again on a later sync, with backoff", async () => {
    let now = 1_000_000;
    const { m, clients } = manager({ now: () => now });
    m.sync(["s"]);
    clients[0].emit("exit", 1);
    expect(m.screen("s")).toBeNull();
    m.sync(["s"]);
    expect(clients).toHaveLength(1);
    now += 2_500;
    m.sync(["s"]);
    expect(clients).toHaveLength(2);
  });
});

const hasTmux = (() => {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// Against a real tmux, on a server of its own (never the default one).
describe.skipIf(!hasTmux)("ControlManager with tmux", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentos-ctl-"));
  const sock = join(dir, "s");
  const env = { ...process.env };
  delete env.TMUX;
  // Every call names this test's own socket.
  const ownTmux = (...args: string[]) =>
    execFileSync("tmux", ["-S", sock, ...args], {
      env,
      stdio: "pipe",
    }).toString();
  let m: ControlManager | undefined;

  afterEach(() => {
    m?.stopAll();
    try {
      ownTmux("kill-server");
    } catch {
      // Already gone.
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("follows a pane's output and reads OSC 7501 from it", async () => {
    ownTmux(
      "new-session",
      "-d",
      "-s",
      "ctl",
      "-x",
      "60",
      "-y",
      "10",
      "sh",
      "-c",
      "sleep 0.5; printf 'ready\\n\\033]7501;working\\033\\\\'; sleep 30"
    );
    const pushed: string[] = [];
    m = new ControlManager({
      spawn: (args) =>
        spawn("tmux", ["-S", sock, ...args], {
          env,
          stdio: ["pipe", "pipe", "ignore"],
        }),
      feed: () => ({ push: (d) => pushed.push(d), close: () => {} }),
      sessionsChanged: () => {},
      attached: () => {},
      detached: () => {},
      now: () => Date.now(),
    });
    m.sync(["ctl"]);
    for (let i = 0; i < 50 && !pushed.join("").includes("7501"); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(pushed.join("")).toContain("\x1b]7501;working");
    for (let i = 0; i < 30 && !m.screen("ctl")?.includes("ready"); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(m.screen("ctl")).toContain("ready");
    // Commands answer over the client, formats and environment included.
    ownTmux("set-environment", "-t", "ctl", "CLAUDE_SESSION_ID", "abc-123");
    expect(
      await m.query("ctl", "show-environment -t ctl CLAUDE_SESSION_ID")
    ).toEqual(["CLAUDE_SESSION_ID=abc-123"]);
    const [path] =
      (await m.query(
        "ctl",
        "display-message -t ctl -p '#{pane_current_path}'"
      )) ?? [];
    expect(path).toMatch(/^\//);
    // The session isn't resized to the control client.
    expect(
      ownTmux(
        "display",
        "-p",
        "-t",
        "ctl",
        "#{window_width}x#{window_height}"
      ).trim()
    ).toBe("60x10");
  });
});
