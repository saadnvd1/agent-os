/**
 * Questions the orchestrator puts to Saad in chat. Marking one open pins it
 * on his Needs-you strip until he answers it (the strip's Reply) or the
 * orchestrator clears it. Unlike an ask it has no Approve or Decline: it is
 * just words that need an answer. Dismissing an item from the strip only
 * hides it, for asks and questions alike.
 */

import { db } from "../db";
import type { QuestionView } from "./ask-view";
import { workspaceTask } from "./targets";

export const MAX_OPEN_QUESTIONS = 10;

interface QuestionRow {
  id: number;
  text: string;
  task: string | null;
  task_name: string | null;
  created_at: string;
}

export function openQuestions(workspaceId: string): QuestionView[] {
  settleQuestions(workspaceId);
  return (
    db
      .prepare(
        `SELECT q.id, q.text, q.task, s.name AS task_name, q.created_at
         FROM orchestrator_questions q LEFT JOIN sessions s ON s.id = q.task
         WHERE q.workspace_id = ? AND q.status = 'open'
         ORDER BY q.id DESC`
      )
      .all(workspaceId) as QuestionRow[]
  ).map((r) => ({
    id: r.id,
    text: r.text,
    task: r.task,
    taskName: r.task_name,
    createdAt: r.created_at,
  }));
}

// A question about work that has finished no longer needs an answer.
function settleQuestions(workspaceId: string): void {
  db.prepare(
    `UPDATE orchestrator_questions
     SET status = 'cleared', resolved_by = 'orchestrator', resolved_at = datetime('now')
     WHERE workspace_id = ? AND status = 'open' AND task IN (
       SELECT id FROM session_rows WHERE task_status IN ('merged', 'dropped', 'done'))`
  ).run(workspaceId);
}

// The same words while open are the same question.
export function askQuestion(
  workspaceId: string,
  text: string,
  taskRef?: string
): string {
  const task = taskRef ? workspaceTask(workspaceId, taskRef).id : null;
  const open = db
    .prepare(
      `SELECT id FROM orchestrator_questions
       WHERE workspace_id = ? AND status = 'open' AND text = ?`
    )
    .get(workspaceId, text) as { id: number } | undefined;
  if (open) return `Question ${open.id} is already open; left as it is.`;
  const count = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM orchestrator_questions
         WHERE workspace_id = ? AND status = 'open'`
      )
      .get(workspaceId) as { n: number }
  ).n;
  if (count >= MAX_OPEN_QUESTIONS)
    return `Not opened: ${count} questions are already open. Clear the ones that no longer matter with resolve_question first.`;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO orchestrator_questions (workspace_id, text, task) VALUES (?, ?, ?)`
    )
    .run(workspaceId, text, task);
  return `Question ${lastInsertRowid} is open on Saad's Needs-you strip. Call resolve_question ${lastInsertRowid} once he has answered or it no longer matters.`;
}

export function resolveQuestion(
  workspaceId: string,
  id: number,
  by: "saad" | "orchestrator"
): boolean {
  return (
    db
      .prepare(
        `UPDATE orchestrator_questions
         SET status = ?, resolved_by = ?, resolved_at = datetime('now')
         WHERE id = ? AND workspace_id = ? AND status = 'open'`
      )
      .run(by === "saad" ? "answered" : "cleared", by, id, workspaceId)
      .changes > 0
  );
}

export function dismissItem(workspaceId: string, key: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO needs_you_dismissed (workspace_id, key) VALUES (?, ?)`
  ).run(workspaceId, key);
}

export function undismissItem(workspaceId: string, key: string): void {
  db.prepare(
    `DELETE FROM needs_you_dismissed WHERE workspace_id = ? AND key = ?`
  ).run(workspaceId, key);
}

export function dismissedKeys(workspaceId: string): string[] {
  return (
    db
      .prepare(`SELECT key FROM needs_you_dismissed WHERE workspace_id = ?`)
      .all(workspaceId) as { key: string }[]
  ).map((r) => r.key);
}
