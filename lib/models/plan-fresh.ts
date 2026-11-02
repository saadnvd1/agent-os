/**
 * Whether the plan file in a task's worktree was written by this task's
 * planning turn. A plan committed to the base branch is checked out with the
 * worktree and reads exactly like a fresh one, so it is refused: tracked by
 * git, older than the worktree's plan folder, or identical to the base's copy.
 */

import fs from "fs";
import path from "path";
import { git } from "../git-exec";

export type PlanVerdict =
  { ok: true; text: string } | { ok: false; why: string };

const PLAN_FILE = ".agentos/plan.md";

export async function checkPlanFile(
  worktree: string,
  base: string | null | undefined
): Promise<PlanVerdict | null> {
  const file = path.join(worktree, PLAN_FILE);
  let text: string;
  let mtime: number;
  try {
    text = fs.readFileSync(file, "utf8");
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const quiet = (args: string[]) =>
    git(worktree, args, { timeout: 15000 }).catch(() => null);
  const tracked = await quiet(["ls-files", "--", PLAN_FILE]);
  // Tracked and untouched is the base's copy; a tracked file the planner
  // rewrote differs from HEAD and is its own.
  if (
    tracked?.trim() &&
    (await quiet(["diff", "--quiet", "HEAD", "--", PLAN_FILE])) !== null
  )
    return { ok: false, why: "it is tracked by git and unchanged" };
  // The plan folder's own .gitignore is written when the task starts.
  const started = (() => {
    try {
      return fs.statSync(
        path.join(worktree, path.dirname(PLAN_FILE), ".gitignore")
      ).mtimeMs;
    } catch {
      return 0;
    }
  })();
  if (started && mtime < started)
    return { ok: false, why: "it was not written since the task started" };
  if (base) {
    for (const ref of [`origin/${base}`, base]) {
      const theirs = await quiet(["show", `${ref}:${PLAN_FILE}`]);
      if (theirs !== null && theirs === text)
        return { ok: false, why: `it is identical to ${ref}'s copy` };
      if (theirs !== null) break;
    }
  }
  return { ok: true, text };
}
