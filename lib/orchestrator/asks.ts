/**
 * The asks list: items the orchestrator parks for Saad. Raising one never
 * blocks it. There's one open ask per subject (a task, the brakes, a title
 * it raised), so an escalation that repeats updates the ask it already has.
 * Saad's answer reaches the orchestrator as an event, and an approval of a
 * gate or brake ask is spent on that one item: never standing permission.
 */

import { db } from "../db";
import { queueEvent } from "./events";
import { addNote } from "./notes";

export const ASK_KINDS = [
  "decision",
  "public",
  "money",
  "irreversible",
  "credentials",
  "product",
  "gate",
  "brake",
] as const;
export type AskKind = (typeof ASK_KINDS)[number];

// The kinds the orchestrator raises itself; gate and brake asks come from
// the gates and brakes.
export const RAISED_KINDS = [
  "decision",
  "public",
  "money",
  "irreversible",
  "credentials",
  "product",
] as const satisfies readonly AskKind[];

export const HARD_LINES: readonly AskKind[] = [
  "public",
  "money",
  "irreversible",
  "credentials",
  "product",
];

export type AskStatus = "open" | "approved" | "declined" | "resolved";

export interface AskRow {
  id: number;
  workspace_id: string;
  subject: string;
  kind: AskKind;
  title: string;
  detail: string;
  link: string | null;
  sha: string | null;
  status: AskStatus;
  answer: string | null;
  created_at: string;
  resolved_at: string | null;
  used_at: string | null;
}

export type AskAnswer =
  | { action: "approve" }
  | { action: "decline" }
  | { action: "reply"; text: string };

const cap = (s: string, n: number) => s.trim().slice(0, n);

export const taskSubject = (taskId: string) => `task:${taskId}`;
export const BRAKE_SUBJECT = "brake";
export const titleSubject = (title: string) =>
  `ask:${title.trim().toLowerCase().replace(/\s+/g, " ")}`;

function openBySubject(workspaceId: string, subject: string): AskRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM orchestrator_asks WHERE workspace_id = ? AND subject = ? AND status = 'open'`
      )
      .get(workspaceId, subject) as AskRow | undefined) ?? null
  );
}

export function getAsk(workspaceId: string, id: number): AskRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM orchestrator_asks WHERE workspace_id = ? AND id = ?`
      )
      .get(workspaceId, id) as AskRow | undefined) ?? null
  );
}

// Parks an item for Saad, or refreshes the open one on the same subject.
export function raiseAsk(input: {
  workspaceId: string;
  subject: string;
  kind: AskKind;
  title: string;
  detail?: string;
  link?: string | null;
  sha?: string | null;
}): { ask: AskRow; created: boolean } {
  const title = cap(input.title, 200);
  if (!title) throw new Error("An ask needs a title");
  const detail = cap(input.detail ?? "", 2000);
  const link = input.link ? cap(input.link, 500) : null;
  const sha = input.sha ?? null;
  return db.transaction(() => {
    const open = openBySubject(input.workspaceId, input.subject);
    if (open) {
      db.prepare(
        `UPDATE orchestrator_asks SET kind = ?, title = ?, detail = ?, link = ?, sha = ? WHERE id = ?`
      ).run(
        input.kind,
        title,
        detail,
        link ?? open.link,
        sha ?? open.sha,
        open.id
      );
      return { ask: getAsk(input.workspaceId, open.id)!, created: false };
    }
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, detail, link, sha)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.workspaceId,
        input.subject,
        input.kind,
        title,
        detail,
        link,
        sha
      );
    return {
      ask: getAsk(input.workspaceId, Number(lastInsertRowid))!,
      created: true,
    };
  })();
}

export function openAsks(workspaceId: string): AskRow[] {
  return db
    .prepare(
      `SELECT * FROM orchestrator_asks WHERE workspace_id = ? AND status = 'open' ORDER BY id`
    )
    .all(workspaceId) as AskRow[];
}

export function openAskCount(workspaceId: string | null | undefined): number {
  if (!workspaceId) return 0;
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM orchestrator_asks WHERE workspace_id = ? AND status = 'open'`
      )
      .get(workspaceId) as { n: number }
  ).n;
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "its head");

// What an approval lets the orchestrator do, said in the event so it can't
// read the approval as anything wider.
function approvalScope(ask: AskRow): string {
  if (ask.kind === "gate")
    return ` (this merge only: sign_off may merge it once, at ${short(ask.sha)})`;
  if (ask.kind === "brake") return " (one start past the brakes, once)";
  if (HARD_LINES.includes(ask.kind))
    return " (this item only, not standing permission)";
  return "";
}

export function answerLine(ask: AskRow, answer: AskAnswer): string {
  const head = `ask "${ask.title}"`;
  if (answer.action === "approve")
    return `${head}: approved${approvalScope(ask)}`;
  if (answer.action === "decline") return `${head}: declined`;
  return `${head}: reply: ${answer.text}`;
}

const STATUS_OF: Record<AskAnswer["action"], AskStatus> = {
  approve: "approved",
  decline: "declined",
  reply: "resolved",
};

// Saad's answer: it closes the ask and reaches the orchestrator as an event,
// queued like any other (so it waits while it's paused).
export function answerAsk(
  workspaceId: string,
  id: number,
  answer: AskAnswer
): AskRow {
  const ask = getAsk(workspaceId, id);
  if (!ask) throw new Error("No such ask");
  if (ask.status !== "open")
    throw new Error(`This ask is already ${ask.status}`);
  const text =
    answer.action === "reply" ? cap(answer.text, 4000) : answer.action;
  if (answer.action === "reply" && !text) throw new Error("The reply is empty");
  const line = answerLine(
    ask,
    answer.action === "reply" ? { action: "reply", text } : answer
  );
  db.transaction(() => {
    db.prepare(
      `UPDATE orchestrator_asks SET status = ?, answer = ?, resolved_at = datetime('now') WHERE id = ?`
    ).run(STATUS_OF[answer.action], text, id);
    queueEvent(workspaceId, `ask:${id}`, null, line);
  })();
  addNote(workspaceId, `Saad answered ${line}`, "ask");
  return getAsk(workspaceId, id)!;
}

// Closes the open ask on a subject that no longer needs Saad (the task was
// merged or dropped, the brakes lifted). No event: nothing for it to do.
export function resolveAsks(
  workspaceId: string,
  subject: string,
  why: string
): number {
  return db
    .prepare(
      `UPDATE orchestrator_asks SET status = 'resolved', answer = ?, resolved_at = datetime('now')
       WHERE workspace_id = ? AND subject = ? AND status = 'open'`
    )
    .run(why, workspaceId, subject).changes;
}
