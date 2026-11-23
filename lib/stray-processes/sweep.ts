// Processes still running from a worktree that no longer exists: the one a
// removal missed, or a task from before this cleanup existed.

import fs from "fs";
import path from "path";
import { WORKTREES_DIR } from "../worktrees";
import { inside, ownedBy, pickProcesses } from "./pick";
import { realDeps, terminate, type StopDeps } from "./stop";
import type { Proc, Stopped } from "./types";

// The worktree folder (<root>/<name>) a process runs from, or null.
function worktreeOf(p: Proc, root: string): string | null {
  const hit = (s: string | null) => {
    if (!s) return null;
    const at = s.replace(/ \(deleted\)$/, "");
    if (!inside(at, root) || at === root) return null;
    return path.join(root, at.slice(root.length + 1).split("/")[0]);
  };
  const fromCwd = hit(p.cwd);
  if (fromCwd) return fromCwd;
  const m = new RegExp(
    `${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([^/\\s'":]+)`
  ).exec(p.command);
  return m ? path.join(root, m[1]) : null;
}

export async function sweepStrayProcesses(
  deps: Partial<StopDeps> = {},
  root = WORKTREES_DIR,
  exists: (p: string) => boolean = fs.existsSync
): Promise<Stopped[]> {
  const d = { ...realDeps, ...deps };
  const procs = await d.list();
  const gone = new Set<string>();
  for (const p of procs) {
    const wt = worktreeOf(p, root);
    if (wt && ownedBy(p, wt) && !exists(wt)) gone.add(wt);
  }
  const stopped: Stopped[] = [];
  for (const wt of gone) {
    const picks = pickProcesses({
      procs,
      worktree: wt,
      serverPids: d.serverPids(),
    });
    stopped.push(...(await terminate(picks, d)));
  }
  return stopped;
}

export async function sweepAndLog(): Promise<void> {
  try {
    const stopped = await sweepStrayProcesses();
    for (const s of stopped)
      console.log(
        `[stray-processes] stopped ${s.pid} from a removed worktree: ${s.command}`
      );
  } catch (error) {
    console.error("[stray-processes] sweep failed:", error);
  }
}
