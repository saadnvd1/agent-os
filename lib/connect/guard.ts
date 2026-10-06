/**
 * Which AgentOS process may open the tunnel. Only one: the real one, built
 * for production, on the configured port, with pairing on. A dev server, a
 * worktree server or a second copy sharing this home folder must not put
 * unreviewed code on the internet or fight the real tunnel.
 */

import fs from "fs";
import path from "path";

export type StartDecision = { start: true } | { start: false; reason: string };

export function shouldStartConnect(
  env: NodeJS.ProcessEnv,
  port: number
): StartDecision {
  if (env.AGENTOS_CONNECT === "0")
    return { start: false, reason: "AGENTOS_CONNECT=0" };
  if (env.NODE_ENV !== "production")
    return { start: false, reason: "not a production build" };
  const configured = Number(env.AGENT_OS_PORT || 3011);
  if (port !== configured && env.AGENTOS_CONNECT !== "1") {
    return {
      start: false,
      reason: `port ${port} isn't AgentOS's port ${configured} (AGENTOS_CONNECT=1 overrides)`,
    };
  }
  if (env.AGENTOS_AUTH === "off")
    return {
      start: false,
      reason: "AGENTOS_AUTH=off: never on the internet without pairing",
    };
  return { start: true };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Holds connect.lock for this process; null if another live process has it. */
export function takeConnectLock(
  dir: string,
  pid = process.pid,
  isAlive: (pid: number) => boolean = alive
): { release: () => void } | { heldBy: number } {
  const lock = path.join(dir, "connect.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, String(pid), { flag: "wx", mode: 0o600 });
      return {
        release: () => {
          try {
            if (fs.readFileSync(lock, "utf8") === String(pid))
              fs.unlinkSync(lock);
          } catch {}
        },
      };
    } catch {
      const holder = Number(fs.readFileSync(lock, "utf8"));
      if (holder && holder !== pid && isAlive(holder))
        return { heldBy: holder };
      fs.rmSync(lock, { force: true }); // stale: its process is gone
    }
  }
  return { heldBy: -1 };
}
