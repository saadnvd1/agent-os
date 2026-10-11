/**
 * Removals of a worktree in progress, visible to every reader. `git
 * worktree remove` takes seconds on a tree with cloned dependencies, and a
 * tree read halfway through lists every file it already deleted as an
 * uncommitted change. The removal that a merge's cleanup starts runs in
 * server.ts while done runs in a route bundle (each loads its own copy of
 * a module) or another process, so besides the in-memory record a marker
 * file beside the worktree says a removal is running.
 */

import fs from "fs";
import os from "os";
import path from "path";

export interface Removal {
  done: Promise<void>;
  // The branch the worktree was on, read before anything was removed.
  branch: Promise<string | null>;
}

const g = globalThis as unknown as { __agentosRemovals?: Map<string, Removal> };
export const removals: Map<string, Removal> = (g.__agentosRemovals ??=
  new Map());

export const removalKey = (p: string) =>
  path.resolve(p.replace(/^~/, os.homedir()));

// Beside the worktree, not in it: git never lists it and the removal
// doesn't delete it.
export const removalMarker = (key: string) =>
  path.join(path.dirname(key), `.${path.basename(key)}.removing`);

// A marker older than this, or whose process is gone, is from a removal
// cut short (a restart) and no longer means anything.
const STALE_MS = 10 * 60_000;

export function markRemoving(key: string): void {
  const marker = removalMarker(key);
  const tmp = `${marker}.${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, at: Date.now() }));
    fs.renameSync(tmp, marker);
  } catch {
    // No marker only means other processes can't see this removal.
  }
}

export function unmarkRemoving(key: string): void {
  fs.rmSync(removalMarker(key), { force: true });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

function markerLive(key: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(removalMarker(key), "utf8");
  } catch {
    return false;
  }
  try {
    const { pid, at } = JSON.parse(raw) as { pid: number; at: number };
    return Date.now() - at < STALE_MS && alive(pid);
  } catch {
    return false;
  }
}

// Whether any code path or process is removing this worktree now.
export const removalRunning = (worktreePath: string) => {
  const key = removalKey(worktreePath);
  return removals.has(key) || markerLive(key);
};

const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Resolves once no removal of this worktree is running: true, or false
 * when one still is after `timeoutMs`.
 */
export async function removalSettled(
  worktreePath: string,
  timeoutMs = 60_000
): Promise<boolean> {
  const key = removalKey(worktreePath);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const own = removals.get(key);
    if (!own && !markerLive(key)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await (own
      ? Promise.race([own.done.catch(() => {}), sleep(left)])
      : sleep(Math.min(250, left)));
  }
}
