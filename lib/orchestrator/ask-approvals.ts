// Spending Saad's approvals (each covers one item, once) and closing asks
// that no longer need him.

import { db } from "../db";
import { resolveAsks, type AskRow } from "./asks";

// An approval on the subject not spent yet, newer than maxAgeMs if given.
export function unspentApproval(
  workspaceId: string,
  subject: string,
  maxAgeMs?: number
): AskRow | null {
  const since =
    maxAgeMs === undefined
      ? "0000"
      : new Date(Date.now() - maxAgeMs)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19);
  return (
    (db
      .prepare(
        `SELECT * FROM orchestrator_asks
         WHERE workspace_id = ? AND subject = ? AND status = 'approved'
           AND used_at IS NULL AND resolved_at >= ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(workspaceId, subject, since) as AskRow | undefined) ?? null
  );
}

// Spends an approval; false if it was already spent.
export function spendApproval(id: number): boolean {
  return (
    db
      .prepare(
        `UPDATE orchestrator_asks SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`
      )
      .run(id).changes === 1
  );
}

// Open asks whose task has since been merged or dropped (by Saad, or
// anyone), closed so they stop needing him.
export function resolveFinishedTaskAsks(workspaceId: string): number {
  const rows = db
    .prepare(
      `SELECT a.subject, s.task_status FROM orchestrator_asks a
       LEFT JOIN sessions s ON a.subject = 'task:' || s.id
       WHERE a.workspace_id = ? AND a.status = 'open' AND a.subject LIKE 'task:%'
         AND (s.id IS NULL OR s.task_status IN ('merged', 'dropped'))`
    )
    .all(workspaceId) as { subject: string; task_status: string | null }[];
  let n = 0;
  for (const r of rows)
    n += resolveAsks(
      workspaceId,
      r.subject,
      r.task_status ? `the task was ${r.task_status}` : "the task is gone"
    );
  return n;
}
