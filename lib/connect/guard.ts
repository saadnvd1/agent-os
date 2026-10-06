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

const holderOf = (file: string): number | null => {
  try {
    return Number(fs.readFileSync(file, "utf8")) || null;
  } catch {
    return null; // gone, or never written
  }
};

/**
 * Holds connect.lock for this process, or names the live process that does.
 * Never throws. A stale lock is taken over by renaming it aside first:
 * of two processes that both judge it stale, only one rename succeeds, and
 * whoever moved a lock that turns out to be live puts it back.
 */
export function takeConnectLock(
  dir: string,
  pid = process.pid,
  isAlive: (pid: number) => boolean = alive
): { release: () => void } | { heldBy: number } {
  const lock = path.join(dir, "connect.lock");
  const mine = {
    release: () => {
      if (holderOf(lock) === pid) fs.rmSync(lock, { force: true });
    },
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(lock, String(pid), { flag: "wx", mode: 0o600 });
      return mine;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST")
        return { heldBy: -1 };
    }
    const holder = holderOf(lock);
    if (holder === pid) return mine;
    if (holder && isAlive(holder)) return { heldBy: holder };
    const aside = `${lock}.stale.${pid}`;
    try {
      fs.renameSync(lock, aside);
    } catch {
      continue; // someone else moved it first; look again
    }
    const moved = holderOf(aside);
    if (moved && moved !== holder && moved !== pid && isAlive(moved)) {
      // Between our look and the rename a live process took the lock: give it back.
      try {
        fs.renameSync(aside, lock);
      } catch {}
      return { heldBy: moved };
    }
    fs.rmSync(aside, { force: true, recursive: true });
  }
  return { heldBy: -1 };
}
