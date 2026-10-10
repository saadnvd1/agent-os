// Spending Saad's approvals: each covers one item, once.

import { db } from "../db";
import type { AskRow } from "./asks";

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

// Saad's newest approval on the subject, if it isn't spent. An older one
// he never saw used is superseded by it, not a fallback: it was for an
// earlier commit.
export function latestApproval(
  workspaceId: string,
  subject: string
): AskRow | null {
  const row = db
    .prepare(
      `SELECT * FROM orchestrator_asks
       WHERE workspace_id = ? AND subject = ? AND status = 'approved'
       ORDER BY id DESC LIMIT 1`
    )
    .get(workspaceId, subject) as AskRow | undefined;
  return row && !row.used_at ? row : null;
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

// Gives back an approval claimed for a merge that was then refused: it is
// spent only on a merge that happened. A voided one stays void.
export function refundApproval(id: number): void {
  db.prepare(
    `UPDATE orchestrator_asks SET used_at = NULL
     WHERE id = ? AND used_at IS NOT NULL AND COALESCE(answer, '') != 'approve (void)'`
  ).run(id);
}

// A merge claims its approval before it runs and gives it back if refused;
// a restart in between leaves it claimed with nothing merged. Claims don't
// outlive the process, so at boot every claim on a task still running goes
// back: a task whose merge happened is merged, or its PR is, and nothing
// can use the approval again.
export function releaseInterruptedClaims(): number {
  return db
    .prepare(
      `UPDATE orchestrator_asks SET used_at = NULL
       WHERE status = 'approved' AND used_at IS NOT NULL
         AND COALESCE(answer, '') != 'approve (void)'
         AND subject IN (SELECT 'task:' || id FROM sessions WHERE task_status = 'running')`
    )
    .run().changes;
}

// Approvals not spent yet on a subject are void once what they were for is
// gone (the brakes lifted): they never carry over to the next one.
export function voidApprovals(workspaceId: string, subject: string): number {
  return db
    .prepare(
      `UPDATE orchestrator_asks SET used_at = datetime('now'), answer = 'approve (void)'
       WHERE workspace_id = ? AND subject = ? AND status = 'approved' AND used_at IS NULL`
    )
    .run(workspaceId, subject).changes;
}
