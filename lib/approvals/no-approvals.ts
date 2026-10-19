/**
 * No approvals mode: while it's on, nothing AgentOS starts or runs waits on
 * a person. Asks are approved as they're raised, brakes let starts through,
 * plan-only tasks go on to implement, and agents launch with their harness's
 * permission prompts off. Off by default; app-wide; every point that honours
 * it reads it here and records what it did with recordAutoApproval.
 */

import { db } from "../db";
import type { ChatAccess } from "../chat/events";
import { addNote } from "../orchestrator/notes";
import { markAllStatusDirty } from "../status/dirty";

export const NO_APPROVALS_KEY = "approvals.none";

export type AuditSource =
  "ask" | "brake" | "plan" | "chat" | "terminal" | "merge-approval" | "mode";

export interface AuditRow {
  id: number;
  at: string;
  source: AuditSource;
  workspace_id: string | null;
  session_id: string | null;
  subject: string;
  detail: string;
}

export function noApprovalsOn(): boolean {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(NO_APPROVALS_KEY) as { value: string } | undefined;
  return row?.value === "1";
}

export function setNoApprovals(on: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(NO_APPROVALS_KEY, on ? "1" : "0");
  markAllStatusDirty();
}

export const AUTO_LABEL = "auto-approved by No approvals mode";

const MAX_DETAIL = 500;

// Writes the audit row, and a note in the workspace's orchestrator chat when
// the approval belongs to one. Never throws: an audit failure must not turn
// into a stuck approval.
export function recordAutoApproval(a: {
  source: AuditSource;
  subject: string;
  detail?: string;
  workspaceId?: string | null;
  sessionId?: string | null;
}): void {
  const detail = (a.detail ?? "").slice(0, MAX_DETAIL);
  try {
    db.prepare(
      `INSERT INTO approval_audit (source, workspace_id, session_id, subject, detail)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      a.source,
      a.workspaceId ?? null,
      a.sessionId ?? null,
      a.subject,
      detail
    );
  } catch (e) {
    console.error("approval audit failed:", e);
  }
  console.log(`[no-approvals] ${a.source}: ${a.subject}`);
  if (a.workspaceId) {
    try {
      addNote(
        a.workspaceId,
        `${AUTO_LABEL[0].toUpperCase()}${AUTO_LABEL.slice(1)}: ${a.subject}${detail ? ` (${detail})` : ""}`,
        "ask"
      );
    } catch (e) {
      console.error("approval note failed:", e);
    }
  }
}

// For a point that's judged again and again (a PR on every poll): one row
// per source and subject.
export function recordAutoApprovalOnce(
  a: Parameters<typeof recordAutoApproval>[0]
): void {
  const seen = db
    .prepare(`SELECT 1 FROM approval_audit WHERE source = ? AND subject = ?`)
    .get(a.source, a.subject);
  if (!seen) recordAutoApproval(a);
}

export function listAutoApprovals(limit = 20): AuditRow[] {
  return db
    .prepare(`SELECT * FROM approval_audit ORDER BY id DESC LIMIT ?`)
    .all(limit) as AuditRow[];
}

// What an agent is launched or kept with: the mode forces the most access,
// so no harness prompts. The stored choice is untouched and returns when the
// mode goes off.
export function effectiveChatAccess(stored: ChatAccess): ChatAccess {
  return noApprovalsOn() ? "full" : stored;
}

export function effectiveAutoApprove(stored: boolean | number): boolean {
  return !!stored || noApprovalsOn();
}
