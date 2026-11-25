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
import { owner } from "../owner";
import { relativeTime } from "../schedules/when";
import { fromSqliteTime } from "../session-meta";

export const MAX_OPEN_QUESTIONS = 10;
// An open question this old is stale: it expires on its own.
export const QUESTION_EXPIRY_DAYS = 3;
const RECENT_DAYS = 7;
const RECENT_SHOWN = 10;
const LINE_TEXT_CAP = 160;

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

// A question about work that has finished no longer needs an answer, and
// one left open past QUESTION_EXPIRY_DAYS has gone stale.
export function settleQuestions(workspaceId: string): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE orchestrator_questions
       SET status = 'cleared', resolved_by = 'orchestrator', resolved_at = datetime('now')
       WHERE workspace_id = ? AND status = 'open' AND task IN (
         SELECT id FROM session_rows WHERE task_status IN ('merged', 'dropped', 'done'))`
    ).run(workspaceId);
    db.prepare(
      `UPDATE orchestrator_questions
       SET status = 'expired', resolved_by = 'expired', resolved_at = datetime('now')
       WHERE workspace_id = ? AND status = 'open' AND created_at <= datetime('now', ?)`
    ).run(workspaceId, `-${QUESTION_EXPIRY_DAYS} days`);
  })();
}

// Whether a task has a question that still needs an answer (not yet swept
// but past expiry doesn't count).
export function taskHasOpenQuestion(taskId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM orchestrator_questions
       WHERE status = 'open' AND task = ? AND created_at > datetime('now', ?)`
    )
    .get(taskId, `-${QUESTION_EXPIRY_DAYS} days`);
}

const oneLine = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= LINE_TEXT_CAP ? t : `${t.slice(0, LINE_TEXT_CAP - 3)}...`;
};

const ageOf = (createdAt: string) =>
  relativeTime(fromSqliteTime(createdAt).getTime());

// One question as the orchestrator reads it: id, age, text, task if any.
export function questionLine(q: QuestionView): string {
  const on = q.taskName
    ? ` | task ${q.taskName}`
    : q.task
      ? ` | task ${q.task.slice(0, 8)}`
      : "";
  return `- [question ${q.id}] ${ageOf(q.createdAt)}: ${oneLine(q.text)}${on}`;
}

// Oldest first: the stale ones are the ones to resolve.
function openOldestFirst(workspaceId: string): QuestionView[] {
  return openQuestions(workspaceId).reverse();
}

export function openQuestionLines(workspaceId: string): string[] {
  return openOldestFirst(workspaceId).map(questionLine);
}

// The read-only `questions` tool.
export function listQuestions(
  workspaceId: string,
  opts: { recent?: boolean } = {}
): string {
  const open = openQuestionLines(workspaceId);
  const parts = [
    open.length
      ? `Open questions (oldest first; ones older than ${QUESTION_EXPIRY_DAYS} days expire on their own):\n${open.join("\n")}`
      : "No open questions.",
  ];
  if (opts.recent) {
    const rows = db
      .prepare(
        `SELECT id, text, status, resolved_at FROM orchestrator_questions
         WHERE workspace_id = ? AND status != 'open' AND resolved_at > datetime('now', ?)
         ORDER BY resolved_at DESC, id DESC LIMIT ?`
      )
      .all(workspaceId, `-${RECENT_DAYS} days`, RECENT_SHOWN) as {
      id: number;
      text: string;
      status: string;
      resolved_at: string;
    }[];
    parts.push(
      rows.length
        ? `Resolved in the last ${RECENT_DAYS} days:\n${rows
            .map(
              (r) =>
                `- [question ${r.id}] ${r.status} ${ageOf(r.resolved_at)}: ${oneLine(r.text)}`
            )
            .join("\n")}`
        : `Nothing resolved in the last ${RECENT_DAYS} days.`
    );
  }
  return parts.join("\n\n");
}

// The same words while open are the same question.
export function askQuestion(
  workspaceId: string,
  text: string,
  taskRef?: string
): string {
  const task = taskRef ? workspaceTask(workspaceId, taskRef).id : null;
  settleQuestions(workspaceId);
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
    return `Not opened: ${count} questions are already open, and none was closed for you. Call resolve_question on each one that was answered or no longer matters, then ask again:\n${openQuestionLines(workspaceId).join("\n")}`;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO orchestrator_questions (workspace_id, text, task) VALUES (?, ?, ?)`
    )
    .run(workspaceId, text, task);
  return `Question ${lastInsertRowid} is open on ${owner()}'s Needs-you strip. Call resolve_question ${lastInsertRowid} once he has answered or it no longer matters.`;
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
