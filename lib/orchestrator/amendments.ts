// Scope changes to a task's brief after it started. The orchestrator
// records one when it tells the task (send with scope_change), so the
// independent review judges the PR against the brief as amended, not only
// the prompt the task was started with.

import { db } from "../db";

export interface Amendment {
  id: number;
  session_id: string;
  workspace_id: string;
  text: string;
  // scope: a change to what the task builds; approval: a plan approved as written.
  kind: "scope" | "approval";
  created_at: string;
}

export function amendBrief(
  workspaceId: string,
  taskId: string,
  text: string,
  kind: Amendment["kind"] = "scope"
): Amendment {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO brief_amendments (session_id, workspace_id, text, kind) VALUES (?, ?, ?, ?)`
    )
    .run(taskId, workspaceId, text.trim(), kind);
  return db
    .prepare(`SELECT * FROM brief_amendments WHERE id = ?`)
    .get(Number(lastInsertRowid)) as Amendment;
}

// Oldest first.
export function amendmentsOf(taskId: string): Amendment[] {
  return db
    .prepare(`SELECT * FROM brief_amendments WHERE session_id = ? ORDER BY id`)
    .all(taskId) as Amendment[];
}

// Only the changes of scope: an approval as written changes nothing.
export const scopeChangesOf = (taskId: string): Amendment[] =>
  amendmentsOf(taskId).filter((a) => a.kind === "scope");
