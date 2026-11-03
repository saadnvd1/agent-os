/**
 * The sessions whose worktree the sweep may consider: settled, quiet, not
 * waiting on anyone, no open PR, and old enough for their project's setting.
 * Everything else is skipped with the reason.
 */

import fs from "fs";
import { db, type Session } from "../db";
import { fromSqliteTime } from "../session-meta";
import { statusOf } from "../orchestrator/facts";
import { isAgentOSWorktree } from "../worktrees";
import { restoring } from "../resurrect/index";
import { inFolder } from "./panes";
import { resolveSweepDays } from "./settings";
import type { Candidate, SweepSkipped } from "./types";

const DAY_MS = 24 * 3600_000;
const SETTLED_TASKS = new Set(["merged", "dropped", "done"]);

export interface SettledDeps {
  now: number;
  panes: string[];
  status: (s: Session) => ReturnType<typeof statusOf>;
  isRestoring: (id: string) => boolean;
}

const ms = (t: string | null | undefined) =>
  t ? fromSqliteTime(t).getTime() : 0;

// When it settled: the earliest of the marks it carries, else its last update;
// anything it did afterwards starts the wait again.
export function settledSinceMs(s: Session): number {
  const marks = [s.merged_at, s.task_ended_at, s.settled_at, s.archived_at]
    .map(ms)
    .filter((t) => t > 0);
  const settled = marks.length ? Math.min(...marks) : ms(s.updated_at);
  return Math.max(settled, ms(s.active_at));
}

export const isSettled = (s: Session) =>
  s.task_status
    ? SETTLED_TASKS.has(s.task_status)
    : !!(s.archived_at || s.settled_at);

function openAsks(): Set<string> {
  const rows = db
    .prepare(`SELECT subject FROM orchestrator_asks WHERE status = 'open'`)
    .all() as Array<{ subject: string }>;
  return new Set(rows.map((r) => r.subject));
}

export async function findSettled(
  deps: SettledDeps
): Promise<{ candidates: Candidate[]; skipped: SweepSkipped[] }> {
  const rows = db
    .prepare(
      `SELECT * FROM session_rows
       WHERE worktree_path IS NOT NULL AND worktree_path != ''
         AND (host_id IS NULL OR host_id = 'local') AND peer_mirror = 0`
    )
    .all() as Session[];
  const asks = openAsks();
  const candidates: Candidate[] = [];
  const skipped: SweepSkipped[] = [];
  for (const s of rows) {
    const dir = s.worktree_path!;
    if (!isSettled(s) || !isAgentOSWorktree(dir) || !fs.existsSync(dir))
      continue;
    const skip = async (): Promise<string | null> => {
      if (s.role) return "an orchestrator's";
      if (s.pinned) return "pinned";
      if (s.moved_to)
        return "its task moved to another machine and may come back";
      if (s.pr_status === "open") return "its PR is open";
      const { days } = resolveSweepDays(s.project_id);
      if (days === 0) return "clean-up is off for its project";
      if (deps.now - settledSinceMs(s) < days * DAY_MS)
        return `settled less than ${days} day${days === 1 ? "" : "s"} ago`;
      if (deps.isRestoring(s.id)) return "it is being restored";
      if (asks.has(`task:${s.id}`)) return "an ask about it is waiting on you";
      const real = fs.realpathSync(dir);
      if (deps.panes.some((p) => inFolder(p, real) || inFolder(p, dir)))
        return "a terminal is open in it";
      const { status, needsInput } = await deps.status(s);
      if (needsInput) return "it is waiting on input";
      if (status !== "idle" && status !== "dead") return `it is ${status}`;
      return null;
    };
    const reason = await skip();
    if (reason)
      skipped.push({ path: dir, kind: "settled", reason, sessionId: s.id });
    else
      candidates.push({
        path: dir,
        kind: "settled",
        sessionId: s.id,
        prNumber: s.pr_number,
        branch: s.branch_name,
      });
  }
  return { candidates, skipped };
}

export const defaultSettledDeps = (
  now = Date.now(),
  panes: string[] = []
): SettledDeps => ({
  now,
  panes,
  status: statusOf,
  isRestoring: restoring,
});
