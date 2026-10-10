import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A task opened while it sets up, here and on a linked machine: both
// machines' terminal servers run in this process, the link between them a
// pair of sockets carried by the real PeerPty.

const ptys = vi.hoisted(
  () => [] as { args: string[]; end: (c: number) => void }[]
);
vi.mock("node-pty", () => ({
  spawn: (_file: string, args: string[]) => {
    let exit: (e: { exitCode: number }) => void = () => {};
    ptys.push({ args, end: (c) => exit({ exitCode: c }) });
    return {
      onData: () => {},
      onExit: (fn: typeof exit) => void (exit = fn),
      write: () => {},
      resize: () => {},
      pause: () => {},
      resume: () => {},
      kill: () => exit({ exitCode: 0 }),
    };
  },
}));
vi.mock("../tasks/start", async () => ({
  launchPending: (await import("../tasks/launch-gate")).launchPending,
  launchHold: () => null,
}));
vi.mock("../agents/launch", () => ({ agentEnv: () => ({}) }));
vi.mock("../hosts", () => ({
  sshTargetFor: (id?: string) => (id === "box" ? "me@box" : null),
}));
vi.mock("../hosts/remote-api", async (actual) => ({
  ...(await actual<typeof import("../hosts/remote-api")>()),
  hostLink: (id?: string) =>
    id === "box"
      ? { hostId: "box", hostName: "box", url: "http://box:3011", token: "t" }
      : null,
}));
// The linked machine's end of each socket is a connection to its server.
vi.mock("../hosts/peer-socket", () => ({
  openPeerSocket: () => {
    const near = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: (d: string) => far.emit("message", Buffer.from(d)),
      close: () => far.emit("close"),
    });
    const far = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: vi.fn(),
      close: () => near.emit("close"),
    });
    serveTerminal(far, new URLSearchParams("flow=1"), {
      rescan: () => {},
      send: (d) => near.emit("message", d),
    });
    queueMicrotask(() => near.emit("open"));
    return near;
  },
}));

const { serveTerminal, SHELL_AFTER_MS } = await import("./connection");
const { GRACE_MS } = await import("./shared-attach");
const { db } = await import("../db");
const { enterStage, setupMoved, startSetup } =
  await import("../sessions/setup-progress");

const TASK = "11111111-2222-3333-4444-555555555555";
const TMUX = `claude-${TASK}`;

function open() {
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  });
  const out: string[] = [];
  serveTerminal(ws, new URLSearchParams(), {
    rescan: () => {},
    send: (d) => {
      const msg = JSON.parse(d) as { type: string; data?: string };
      if (msg.type === "output") out.push(msg.data ?? "");
    },
  });
  const attach = (spec: object) =>
    ws.emit("message", Buffer.from(JSON.stringify({ type: "attach", spec })));
  const type = (data: string) =>
    ws.emit("message", Buffer.from(JSON.stringify({ type: "input", data })));
  return { ws, out, attach, type, screen: () => out.join("") };
}

const shells = () => ptys.filter((p) => !p.args.join(" ").includes("tmux"));
const attaches = () => ptys.filter((p) => p.args.join(" ").includes("tmux"));

// Its launch finishing, as lib/tasks/start records it.
function launch() {
  db.prepare(`UPDATE sessions SET setup_status = 'ok' WHERE id = ?`).run(TASK);
  setupMoved(TASK);
}

// A fresh setup each run: the live progress outlasts a test.
let setup: ReturnType<typeof startSetup>;
beforeEach(() => {
  vi.useFakeTimers();
  ptys.length = 0;
  setup = startSetup(TASK, "feature/x", { task: true });
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(TASK);
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, setup_status)
     VALUES (?, 'task', ?, '/tmp', 'running', 'running')`
  ).run(TASK, TMUX);
});
afterEach(async () => {
  // Past both machines' shared attach grace, so the next test attaches afresh.
  await vi.advanceTimersByTimeAsync(2 * GRACE_MS + 1);
  vi.useRealTimers();
});

// The last is a pane naming only the tmux session, with no row for it here
// (the two machines share one database in this test): the linked machine
// still knows it by that name.
describe.each([
  ["locally, with its id", { sessionName: TMUX, sessionId: TASK }, true],
  [
    "locally, by its tmux name only",
    { sessionName: TMUX, attachOnly: true },
    true,
  ],
  [
    "on a linked machine",
    { sessionName: TMUX, sessionId: TASK, hostId: "box" },
    true,
  ],
  [
    "on a linked machine, by its tmux name only",
    { sessionName: TMUX, hostId: "box", attachOnly: true },
    false,
  ],
])("a task opened while it sets up, %s", (_where, spec, known) => {
  it("shows its setup with no shell, then attaches to the launched agent", async () => {
    const view = open();
    view.attach(spec);
    await vi.advanceTimersByTimeAsync(SHELL_AFTER_MS + 100);
    view.type("ls\r");
    await vi.advanceTimersByTimeAsync(SHELL_AFTER_MS + 100);
    expect(ptys).toHaveLength(0);
    expect(view.screen()).toContain("Setting up this task");

    // Redrawn as it moves, woken by the setup (well before the recheck).
    const running = "\x1b[33m› Install dependencies";
    expect(view.screen()).not.toContain(running);
    enterStage(setup, "deps");
    await vi.advanceTimersByTimeAsync(200);
    expect(view.screen()).toContain(running);

    launch();
    await vi.advanceTimersByTimeAsync(200);
    expect(attaches()).toHaveLength(1);
    expect(shells()).toHaveLength(0);

    view.ws.emit("close");
  });

  it.runIf(known)(
    "leaves no shell behind when its agent's tmux ends",
    async () => {
      launch();
      const view = open();
      view.attach(spec);
      await vi.advanceTimersByTimeAsync(SHELL_AFTER_MS + 100);
      expect(attaches()).toHaveLength(1);
      attaches()[0].end(1);
      await vi.advanceTimersByTimeAsync(SHELL_AFTER_MS + 100);
      view.type("ls\r");
      expect(shells()).toHaveLength(0);
      view.ws.emit("close");
    }
  );
});

describe("which session an attach naming only a tmux session is", () => {
  it("is the one on that machine: this one's, or a linked one's mirror", async () => {
    const { sessionForTmux } = await import("./pending-launch");
    const mirror = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id)
       VALUES (?, 'm', 'claude-shared', '/tmp', 'box')`
    ).run(mirror);
    expect(sessionForTmux("box", "claude-shared")).toBe(mirror);
    expect(sessionForTmux(undefined, "claude-shared")).toBeNull();
    expect(sessionForTmux("box", TMUX)).toBeNull();
    expect(sessionForTmux("local", TMUX)).toBe(TASK);
  });
});
