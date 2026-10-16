import fs from "fs";
import path from "path";
import { readLiveRecord } from "./liveServer";
import { pickPort } from "./pickPort";
import { pidAlive, processCwd, samePath } from "./processInfo";
import { spawnServer } from "./spawnServer";
import type { DevRecord } from "./types";

export const recordFile = (worktree: string) =>
  path.join(worktree, ".agentos", "dev-server.json");

export function readDevRecord(worktree: string): DevRecord | null {
  try {
    return JSON.parse(fs.readFileSync(recordFile(worktree), "utf8"));
  } catch {
    return null;
  }
}

const DROPPED = [
  "TMUX",
  "AGENTOS_URL",
  "AGENTOS_PORT",
  "AGENTOS_SESSION_ID",
  "AGENTOS_SERVER",
];

export async function startDevServer(opts: {
  worktree: string;
  requested?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<DevRecord & { reused: boolean }> {
  const { worktree, requested, env = process.env } = opts;
  const existing = readDevRecord(worktree);
  if (
    existing &&
    pidAlive(existing.pid) &&
    samePath(processCwd(existing.pid) ?? "", worktree)
  )
    return { ...existing, reused: true };

  const port = await pickPort({ requested, env, live: readLiveRecord() });
  const dir = path.join(worktree, ".agentos");
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  const tmux = path.join(worktree, ".dev-tmux");
  fs.mkdirSync(tmux, { recursive: true });

  const childEnv = { ...env };
  for (const k of DROPPED) delete childEnv[k];
  const log = path.join(dir, "dev-server.log");
  const fd = fs.openSync(log, "a");
  const child = spawnServer({
    repo: worktree,
    port,
    env: {
      ...childEnv,
      NODE_ENV: "development",
      AGENTOS_DEV: "1",
      TMUX_TMPDIR: tmux,
      DB_PATH: path.join(worktree, ".dev.db"),
    },
    stdio: ["ignore", fd, fd],
    detached: true,
    native: true,
  });
  child.unref();
  fs.closeSync(fd);
  if (child.pid === undefined) throw new Error("The server did not start");
  const rec: DevRecord = {
    pid: child.pid,
    port,
    cwd: worktree,
    startedAt: Date.now(),
    log,
  };
  fs.writeFileSync(recordFile(worktree), JSON.stringify(rec, null, 2));
  return { ...rec, reused: false };
}
