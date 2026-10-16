import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { afterEach, describe, expect, it } from "vitest";
import { stopDevServer } from "./stopDevServer";
import { pidAlive } from "./processInfo";

const children: ChildProcess[] = [];
const dir = () =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stop-")));

function sleeper(cwd: string): ChildProcess {
  const c = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  children.push(c);
  return c;
}

function record(worktree: string, pid: number) {
  fs.mkdirSync(path.join(worktree, ".agentos"), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, ".agentos", "dev-server.json"),
    JSON.stringify({ pid, port: 3200, cwd: worktree, startedAt: 1, log: "" })
  );
}

afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

describe("stopDevServer", () => {
  it("refuses a pid whose cwd is not the worktree", async () => {
    const wt = dir();
    const c = sleeper(dir());
    record(wt, c.pid!);
    const r = await stopDevServer(wt, { livePid: () => null });
    expect(r.ok).toBe(false);
    expect(pidAlive(c.pid!)).toBe(true);
    expect(fs.existsSync(path.join(wt, ".agentos", "dev-server.json"))).toBe(
      true
    );
  });

  it("refuses the live server's pid even from the worktree", async () => {
    const wt = dir();
    const c = sleeper(wt);
    record(wt, c.pid!);
    const r = await stopDevServer(wt, { livePid: () => c.pid! });
    expect(r.ok).toBe(false);
    expect(pidAlive(c.pid!)).toBe(true);
  });

  it("refuses a process that looks like the live server", async () => {
    const wt = dir();
    const c = sleeper(wt);
    record(wt, c.pid!);
    const r = await stopDevServer(wt, {
      livePid: () => null,
      looksLive: () => true,
    });
    expect(r.ok).toBe(false);
    expect(pidAlive(c.pid!)).toBe(true);
  });

  it("stops the recorded process and removes the record", async () => {
    const wt = dir();
    const c = sleeper(wt);
    record(wt, c.pid!);
    const exited = new Promise((r) => c.once("exit", r));
    const r = await stopDevServer(wt, {
      livePid: () => null,
      looksLive: () => false,
    });
    await exited;
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(wt, ".agentos", "dev-server.json"))).toBe(
      false
    );
  });

  it("drops a stale record without killing anything", async () => {
    const wt = dir();
    record(wt, 2 ** 22 + 12345);
    const r = await stopDevServer(wt);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(wt, ".agentos", "dev-server.json"))).toBe(
      false
    );
  });
});
