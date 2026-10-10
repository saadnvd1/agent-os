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
  created_at: string;
}

export function amendBrief(
  workspaceId: string,
  taskId: string,
  text: string
): Amendment {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO brief_amendments (session_id, workspace_id, text) VALUES (?, ?, ?)`
    )
    .run(taskId, workspaceId, text.trim());
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
