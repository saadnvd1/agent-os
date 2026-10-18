import fs from "fs";
import path from "path";
import { readLiveRecord } from "./liveServer";
import {
  pidAlive,
  looksLive,
  processCwd,
  samePath,
  probe,
  ProbeTimeout,
} from "./processInfo";
import { readDevRecord, recordFile } from "./startDevServer";

export interface StopDeps {
  kill: (pid: number, signal: NodeJS.Signals) => void;
  cwdOf: (pid: number) => string | null | Promise<string | null>;
  looksLive: (pid: number) => boolean | Promise<boolean>;
  livePid: () => number | null;
  alive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  killTmux: (socket: string) => void | Promise<void>;
}

const realDeps: StopDeps = {
  kill: (pid, signal) => process.kill(pid, signal),
  cwdOf: processCwd,
  looksLive,
  livePid: () => readLiveRecord()?.pid ?? null,
  alive: pidAlive,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  killTmux: async (socket) => {
    try {
      await probe("env", ["-u", "TMUX", "tmux", "-S", socket, "kill-server"]);
    } catch (e) {
      // No server on it, or tmux did not answer in time.
      if (e instanceof ProbeTimeout)
        console.warn(`[dev-server] tmux on ${socket} did not answer; left`);
    }
  },
};

export interface StopResult {
  ok: boolean;
  message: string;
}

// Stops only the process this worktree's dev:task started, after checking
// it is still that process: same working directory, not the live server.
export async function stopDevServer(
  worktree: string,
  deps: Partial<StopDeps> = {}
): Promise<StopResult> {
  const d = { ...realDeps, ...deps };
  const rec = readDevRecord(worktree);
  if (!rec) return { ok: true, message: "No dev server recorded here." };
  const drop = () => fs.rmSync(recordFile(worktree), { force: true });
  if (!d.alive(rec.pid)) {
    drop();
    return { ok: true, message: `Dev server ${rec.pid} is not running.` };
  }
  const refuse = (why: string): StopResult => ({
    ok: false,
    message: `Refusing to stop pid ${rec.pid}: ${why}. Nothing was killed.`,
  });
  const cwd = await d.cwdOf(rec.pid);
  if (cwd === null || !samePath(cwd, worktree))
    return refuse(
      `its working directory (${cwd ?? "unknown"}) is not ${worktree}`
    );
  if (rec.pid === process.pid || rec.pid === process.ppid)
    return refuse("that is this command's own process");
  if (rec.pid === d.livePid() || (await d.looksLive(rec.pid)))
    return refuse("it is the live AgentOS server");

  const signal = (s: NodeJS.Signals) => {
    try {
      d.kill(-rec.pid, s);
    } catch {
      try {
        d.kill(rec.pid, s);
      } catch {
        // Already gone.
      }
    }
  };
  signal("SIGTERM");
  for (let i = 0; i < 50 && d.alive(rec.pid); i++) await d.sleep(100);
  if (d.alive(rec.pid)) signal("SIGKILL");
  const sock = path.join(
    worktree,
    ".dev-tmux",
    `tmux-${process.getuid?.() ?? 0}`,
    "default"
  );
  if (fs.existsSync(sock)) await d.killTmux(sock);
  drop();
  return {
    ok: true,
    message: `Stopped dev server ${rec.pid} (port ${rec.port}).`,
  };
}
