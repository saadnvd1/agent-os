/**
 * The asks list: items the orchestrator parks for Saad. Raising one never
 * blocks it. There's one open ask per subject (a task, the brakes, a title
 * it raised), so an escalation that repeats updates the ask it already has.
 * Saad's answer reaches the orchestrator as an event, and an approval of a
 * gate or brake ask is spent on that one item: never standing permission.
 */

import { db } from "../db";
import { answerKey, queueEvent } from "./events";
import { addNote } from "./notes";
import { cleanTitle, classifyKind, titleSubject } from "./ask-text";
import { revokePasskey } from "../security/passkeys";
import type { AskKind } from "./ask-view";

export { ASK_KINDS, type AskKind } from "./ask-view";

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

// Approving these needs a passkey assertion, not just a trusted device.
export const PRESENCE_KINDS: readonly AskKind[] = [
  ...HARD_LINES,
  "gate",
  "brake",
  "passkey",
];

// At most this many open asks per workspace, and a declined subject isn't
// asked again for a while.
export const MAX_OPEN_ASKS = 10;
export const DECLINE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export class AskRefused extends Error {}

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
  brake_key: string | null;
}

export type AskAnswer =
  | { action: "approve" }
  | { action: "decline" }
  | { action: "reply"; text: string };

const cap = (s: string, n: number) => s.trim().slice(0, n);

export const taskSubject = (taskId: string) => `task:${taskId}`;
// A PR no AgentOS task owns (external-pr.ts) is its own subject.
export const EXTERNAL_PREFIX = "pr:";
export const workSubject = (id: string) =>
  id.startsWith(EXTERNAL_PREFIX) ? id : taskSubject(id);
export const BRAKE_SUBJECT = "brake";
export const passkeySubject = (id: string) => `passkey:${id}`;
export const revokedPasskeySubject = (id: string) => `passkey-revoked:${id}`;

// What an approval is pinned to: the commit a gate ask was about, the brake
// a brake ask was about, else the ask itself. Approve must send it back.
export const askBinding = (ask: AskRow) =>
  ask.sha ?? ask.brake_key ?? ask.subject;

const sqliteTime = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19);

// Declined lately: the same subject, or a title that says the same thing
// in other words (so rewording doesn't get round a no).
function refusal(
  workspaceId: string,
  subject: string,
  title: string
): string | null {
  const words = titleSubject(title);
  const declined = (
    db
      .prepare(
        `SELECT subject, title FROM orchestrator_asks WHERE workspace_id = ?
           AND status = 'declined' AND resolved_at >= ?`
      )
      .all(workspaceId, sqliteTime(Date.now() - DECLINE_COOLDOWN_MS)) as {
      subject: string;
      title: string;
    }[]
  ).find((d) => d.subject === subject || titleSubject(d.title) === words);
  if (declined)
    return `Saad declined "${declined.title}" in the last 6 hours; don't ask again yet`;
  if (openAskCount(workspaceId) >= MAX_OPEN_ASKS)
    return `Saad already has ${MAX_OPEN_ASKS} open asks here; wait for answers before adding more`;
  return null;
}

export function openBySubject(
  workspaceId: string,
  subject: string
): AskRow | null {
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
  brakeKey?: string | null;
}): { ask: AskRow; created: boolean } {
  const title = cleanTitle(input.title);
  if (!title) throw new Error("An ask needs a title");
  const detail = cap(input.detail ?? "", 2000);
  const link = input.link ? cap(input.link, 500) : null;
  const kind = classifyKind(input.kind, title, detail);
  const sha = input.sha ?? null;
  const brakeKey = input.brakeKey ?? null;
  return db.transaction(() => {
    const open = openBySubject(input.workspaceId, input.subject);
    if (open) {
      db.prepare(
        `UPDATE orchestrator_asks SET kind = ?, title = ?, detail = ?, link = ?, sha = ?, brake_key = ? WHERE id = ?`
      ).run(
        kind,
        title,
        detail,
        link ?? open.link,
        sha ?? open.sha,
        brakeKey ?? open.brake_key,
        open.id
      );
      return { ask: getAsk(input.workspaceId, open.id)!, created: false };
    }
    const refused = refusal(input.workspaceId, input.subject, title);
    if (refused) throw new AskRefused(refused);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, detail, link, sha, brake_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.workspaceId,
        input.subject,
        kind,
        title,
        detail,
        link,
        sha,
        brakeKey
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
// An approval names what it approves (`binding`); if the ask moved on since
// (a new commit, another brake), it's refused rather than approving that.
export function answerAsk(
  workspaceId: string,
  id: number,
  answer: AskAnswer,
  binding?: string
): AskRow {
  const ask = getAsk(workspaceId, id);
  if (!ask) throw new Error("No such ask");
  if (ask.status !== "open")
    throw new Error(`This ask is already ${ask.status}`);
  if (
    answer.action !== "reply" &&
    binding !== undefined &&
    binding !== askBinding(ask)
  )
    throw new Error("This ask changed since you saw it; look again");
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
    if (ask.kind === "passkey") settlePasskeyAsk(ask, answer.action);
    else queueEvent(workspaceId, answerKey(id), null, line);
  })();
  addNote(workspaceId, `Saad answered ${line}`, "ask");
  return getAsk(workspaceId, id)!;
}

// A passkey ask sits in every workspace: one answer settles them all, and
// declining a new passkey's ask revokes it. The orchestrator isn't told.
function settlePasskeyAsk(ask: AskRow, action: AskAnswer["action"]): void {
  const added = ask.subject.startsWith("passkey:");
  if (added && action === "decline")
    revokePasskey(ask.subject.slice("passkey:".length));
  db.prepare(
    `UPDATE orchestrator_asks SET status = 'resolved', answer = ?, resolved_at = datetime('now')
     WHERE subject = ? AND status = 'open'`
  ).run(added && action === "decline" ? "revoked" : "seen", ask.subject);
}

export function resolvePasskeyAsks(passkeyId: string, why: string): number {
  return db
    .prepare(
      `UPDATE orchestrator_asks SET status = 'resolved', answer = ?, resolved_at = datetime('now')
       WHERE subject = ? AND status = 'open'`
    )
    .run(why, passkeySubject(passkeyId)).changes;
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
