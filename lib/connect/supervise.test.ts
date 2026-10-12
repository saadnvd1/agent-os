import { describe, it, expect, afterEach, vi } from "vitest";
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { ApiError } from "./control-api";
import { execFileSync } from "child_process";
import {
  reapTunnel,
  spawnTunnel,
  superviseTunnel,
  type Spawn,
} from "./supervise";

const fakeToken = () =>
  Buffer.from(
    JSON.stringify({
      a: crypto.randomBytes(16).toString("hex"),
      t: crypto.randomUUID(),
      s: crypto.randomBytes(32).toString("base64"),
    })
  ).toString("base64");

const delays = { min: 10, max: 40, setupMax: 40, denied: 30 };
const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

class FakeChild extends EventEmitter {
  static next = 40000;
  pid = FakeChild.next++;
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: string[] = [];
  constructor(
    readonly args: string[],
    readonly env: Record<string, string>
  ) {
    super();
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    setImmediate(() => this.emit("exit", null));
    return true;
  }
  say(entry: Record<string, unknown>) {
    this.stderr.write(JSON.stringify(entry) + "\n");
  }
}

function harness(prepare?: () => Promise<{ bin: string; token: string }>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-sup-"));
  const children: FakeChild[] = [];
  const tokens: string[] = [];
  const logs: string[] = [];
  const spawn: Spawn = (_bin, args, opts) => {
    const c = new FakeChild(args, opts.env);
    children.push(c);
    return c;
  };
  const sup = superviseTunnel({
    dir,
    delays,
    spawn,
    log: (l) => logs.push(l),
    prepare:
      prepare ??
      (async () => {
        tokens.push(fakeToken());
        return {
          bin: path.join(dir, "bin", "cloudflared"),
          token: tokens.at(-1)!,
        };
      }),
  });
  stops.push(sup.stop);
  return { dir, sup, children, tokens, logs };
}

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((s) => s());
  vi.unstubAllEnvs();
});

describe("superviseTunnel", () => {
  it("hands the token to cloudflared in its env only, with nothing else of ours", async () => {
    const secret = `secret-${crypto.randomUUID()}`;
    vi.stubEnv("AGENTOS_TEST_SECRET", secret);
    const h = harness();
    await until(() => h.children.length === 1);
    const [c] = h.children;
    expect(Object.keys(c.env).sort()).toEqual(["HOME", "PATH", "TUNNEL_TOKEN"]);
    expect(c.env.AGENTOS_TEST_SECRET).toBeUndefined();
    expect(Object.values(c.env)).not.toContain(secret);
    expect(c.env.TUNNEL_TOKEN).toBe(h.tokens[0]);
    expect(c.env.HOME.startsWith(h.dir)).toBe(true);
    expect(c.args.join(" ")).not.toContain(h.tokens[0]);
    expect(c.args).toEqual([
      "tunnel",
      "--config",
      path.join(h.dir, "cloudflared.yml"),
      "--no-autoupdate",
      "--loglevel",
      "info",
      "--output",
      "json",
      "run",
    ]);
    for (const f of fs.readdirSync(h.dir, { recursive: true }) as string[]) {
      const p = path.join(h.dir, f);
      if (fs.statSync(p).isFile())
        expect(fs.readFileSync(p, "utf8")).not.toContain(h.tokens[0]);
    }
  });

  it("is up once a connection registers, and keeps the token out of its logs", async () => {
    const h = harness();
    await until(() => h.children.length === 1);
    const [c] = h.children;
    expect(h.sup.state()).toBe("connecting");
    c.say({
      level: "info",
      message: "Registered tunnel connection",
      connIndex: 0,
    });
    await until(() => h.sup.state() === "up");
    c.say({
      level: "error",
      message: "Serve tunnel error",
      error: `refused ${h.tokens[0]}`,
      connIndex: 0,
    });
    await until(() => h.sup.state() === "connecting");
    expect(h.sup.reason()).toContain("[token]");
    expect(h.logs.join("\n")).not.toContain(h.tokens[0]);
    expect(h.logs.join("\n")).toContain("Serve tunnel error");
  });

  it("starts it again with a fresh token when it exits", async () => {
    const h = harness();
    await until(() => h.children.length === 1);
    expect(fs.readFileSync(path.join(h.dir, "cloudflared.pid"), "utf8")).toBe(
      String(h.children[0].pid)
    );
    h.children[0].emit("exit", 1);
    await until(() => h.children.length === 2);
    expect(h.tokens).toHaveLength(2);
    expect(h.children[1].env.TUNNEL_TOKEN).toBe(h.tokens[1]);
    expect(h.tokens[1]).not.toBe(h.tokens[0]);
  });

  it("stops it, and never starts it again once stopped", async () => {
    const h = harness();
    await until(() => h.children.length === 1);
    h.sup.stop();
    expect(h.children[0].signals).toEqual(["SIGTERM"]);
    expect(h.sup.state()).toBe("stopped");
    await new Promise((r) => setTimeout(r, 100));
    expect(h.children).toHaveLength(1);
    expect(fs.existsSync(path.join(h.dir, "cloudflared.pid"))).toBe(false);
  });

  it("waits longer when the service refuses the machine, then asks again", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new ApiError("machine disabled", 403, {});
    });
    await until(() => h.sup.state() === "denied");
    expect(h.sup.reason()).toBe("machine disabled");
    expect(h.children).toHaveLength(0);
    await until(() => calls >= 2);
  });

  it("retries with backoff when a token or the binary can't be had", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new Error("cloudflared download doesn't match its pinned SHA-256");
    });
    await until(() => calls >= 3);
    expect(h.sup.state()).toBe("error");
    expect(h.children).toHaveLength(0);
  });

  it("survives a failing write in its own folder and keeps retrying", async () => {
    const rejections: unknown[] = [];
    const onRejection = (r: unknown) => rejections.push(r);
    process.on("unhandledRejection", onRejection);
    try {
      let calls = 0;
      const h: ReturnType<typeof harness> = harness(async () => {
        calls++;
        return {
          bin: path.join(h.dir, "bin", "cloudflared"),
          token: fakeToken(),
        };
      });
      // cloudflared.yml can't be written while a folder sits in its place.
      const config = path.join(h.dir, "cloudflared.yml");
      fs.mkdirSync(config);
      await until(() => calls >= 2);
      expect(h.sup.state()).toBe("error");
      expect(h.sup.reason()).toContain("EISDIR");
      expect(h.children).toHaveLength(0);
      fs.rmdirSync(config);
      await until(() => h.children.length === 1);
      await new Promise((r) => setTimeout(r, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("cloudflared never outlives AgentOS", () => {
  it("takes it down on a signal nobody else handles, before AgentOS goes", async () => {
    const h = harness();
    await until(() => h.children.length === 1);
    // Stands in for whoever else handles it, so this test process lives on.
    const other = () => {};
    process.on("SIGTERM", other);
    try {
      process.emit("SIGTERM", "SIGTERM");
      expect(h.children[0].signals).toEqual(["SIGTERM"]);
    } finally {
      process.off("SIGTERM", other);
    }
  });

  it("drops its signal and exit handlers once stopped", async () => {
    const before = ["SIGTERM", "SIGINT", "SIGHUP", "exit"].map((s) =>
      process.listenerCount(s)
    );
    const h = harness();
    await until(() => h.children.length === 1);
    h.sup.stop();
    expect(
      ["SIGTERM", "SIGINT", "SIGHUP", "exit"].map((s) =>
        process.listenerCount(s)
      )
    ).toEqual(before);
  });

  describe("reapTunnel", () => {
    const setup = (pid: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-reap-"));
      fs.writeFileSync(path.join(dir, "cloudflared.pid"), pid);
      return dir;
    };

    it("kills the group and the pid when it's still our cloudflared", async () => {
      const dir = setup("5151");
      const calls: [number, NodeJS.Signals | 0][] = [];
      let alive = 3;
      const reaped = await reapTunnel(dir, undefined, {
        commandOf: async () =>
          `${path.join(dir, "bin", "cloudflared-2026.10.0")} tunnel run`,
        kill: (pid, sig) => {
          calls.push([pid, sig]);
          return sig === 0 ? --alive > 0 : true;
        },
        waitMs: 1000,
      });
      expect(reaped).toBe(true);
      expect(calls.slice(0, 2)).toEqual([
        [-5151, "SIGKILL"],
        [5151, "SIGKILL"],
      ]);
      // Waited for it to be gone.
      expect(alive).toBe(0);
      expect(fs.existsSync(path.join(dir, "cloudflared.pid"))).toBe(false);
    });

    it("never signals a reused pid that isn't ours", async () => {
      const dir = setup("5151");
      const calls: number[] = [];
      const reaped = await reapTunnel(dir, undefined, {
        commandOf: async () => "/Applications/Other.app/Contents/MacOS/Other",
        kill: (pid) => (calls.push(pid), true),
      });
      expect(reaped).toBe(false);
      expect(calls).toEqual([]);
      expect(fs.existsSync(path.join(dir, "cloudflared.pid"))).toBe(false);
    });

    it("does nothing without a pid file", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-reap-"));
      expect(await reapTunnel(dir, undefined, { kill: () => true })).toBe(
        false
      );
    });
  });

  describe.skipIf(process.platform === "win32")(
    "spawnTunnel (real processes)",
    () => {
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      // A stand-in cloudflared: notes its pid, then waits.
      function fakeBin() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-spawn-"));
        const bin = path.join(dir, "cloudflared");
        const pidOut = path.join(dir, "child.pid");
        fs.writeFileSync(
          bin,
          `#!/bin/sh\necho $$ > "${pidOut}"\nexec sleep 30\n`,
          { mode: 0o700 }
        );
        return { bin, pidOut };
      }

      async function run(token: string) {
        const { bin, pidOut } = fakeBin();
        const proc = spawnTunnel(bin, ["tunnel", "run"], {
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            TUNNEL_TOKEN: token,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const exited = new Promise<void>((r) => proc.on("exit", () => r()));
        await until(
          () =>
            fs.existsSync(pidOut) && !!fs.readFileSync(pidOut, "utf8").trim(),
          5000
        );
        const child = Number(fs.readFileSync(pidOut, "utf8"));
        return { proc, child, exited };
      }

      it("keeps the token out of every argv ps can show", async () => {
        const token = fakeToken();
        const { proc, child, exited } = await run(token);
        try {
          const table = execFileSync(
            "ps",
            ["-o", "pid=,command=", "-p", `${proc.pid},${child}`],
            { encoding: "utf8" }
          );
          expect(table).toContain(String(child));
          expect(table).not.toContain(token);
        } finally {
          proc.kill("SIGKILL");
          await exited;
        }
      });

      it("kills cloudflared when AgentOS goes away (its end of the pipe closes)", async () => {
        const { proc, child, exited } = await run(fakeToken());
        expect(alive(child)).toBe(true);
        proc.stdin!.destroy();
        await exited;
        await until(() => !alive(child), 5000);
      });

      it("kills the whole group, cloudflared included", async () => {
        const { proc, child, exited } = await run(fakeToken());
        proc.kill("SIGTERM");
        await exited;
        await until(() => !alive(child), 5000);
      });
    }
  );
});
