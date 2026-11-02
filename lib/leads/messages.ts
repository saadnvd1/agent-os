import { db } from "@/lib/db";
import type { LeadKind, LeadMessage } from "./types";

const TEXT_CAP = 4000;

interface Row {
  id: number;
  workspace_id: string;
  from_kind: string;
  to_kind: string;
  thread: string;
  text: string;
  created_at: string;
  read_at: string | null;
}

const view = (r: Row): LeadMessage => ({
  id: r.id,
  workspaceId: r.workspace_id,
  fromKind: r.from_kind,
  toKind: r.to_kind,
  thread: r.thread,
  text: r.text,
  createdAt: r.created_at,
  readAt: r.read_at,
});

// Lead-to-lead and chief-to-lead mail. The chief writes as "chief".
export function addLeadMessage(m: {
  workspaceId: string;
  fromKind: LeadKind;
  toKind: LeadKind;
  thread: string;
  text: string;
}): LeadMessage {
  const text = m.text.trim().slice(0, TEXT_CAP);
  const thread = m.thread.trim().slice(0, 120);
  if (!text || !thread) throw new Error("A message needs a thread and text");
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO lead_messages (workspace_id, from_kind, to_kind, thread, text)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(m.workspaceId, m.fromKind, m.toKind, thread, text);
  return view(
    db
      .prepare(`SELECT * FROM lead_messages WHERE id = ?`)
      .get(Number(lastInsertRowid)) as Row
  );
}

export function unreadFor(
  workspaceId: string,
  toKind: LeadKind
): LeadMessage[] {
  return (
    db
      .prepare(
        `SELECT * FROM lead_messages
         WHERE workspace_id = ? AND to_kind = ? AND read_at IS NULL ORDER BY id`
      )
      .all(workspaceId, toKind) as Row[]
  ).map(view);
}

export function markRead(
  workspaceId: string,
  toKind: LeadKind,
  upToId: number
): number {
  return db
    .prepare(
      `UPDATE lead_messages SET read_at = datetime('now')
       WHERE workspace_id = ? AND to_kind = ? AND id <= ? AND read_at IS NULL`
    )
    .run(workspaceId, toKind, upToId).changes;
}

export function threadMessages(
  workspaceId: string,
  thread: string,
  limit = 50
): LeadMessage[] {
  return (
    db
      .prepare(
        `SELECT * FROM (SELECT * FROM lead_messages WHERE workspace_id = ? AND thread = ?
         ORDER BY id DESC LIMIT ?) ORDER BY id`
      )
      .all(workspaceId, thread, limit) as Row[]
  ).map(view);
}

// Sent within the window from one lead to another on a thread, for the
// loop guard.
export function sentSince(
  workspaceId: string,
  fromKind: LeadKind,
  toKind: LeadKind,
  thread: string,
  sinceSqlite: string
): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM lead_messages
         WHERE workspace_id = ? AND from_kind = ? AND to_kind = ? AND thread = ?
           AND created_at >= ?`
      )
      .get(workspaceId, fromKind, toKind, thread, sinceSqlite) as { n: number }
  ).n;
}
