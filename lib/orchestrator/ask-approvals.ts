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
