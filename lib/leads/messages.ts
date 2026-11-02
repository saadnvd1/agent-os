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
  pins: string | null;
}

const pinIds = (raw: string | null): number[] => {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

const view = (r: Row): LeadMessage => ({
  id: r.id,
  workspaceId: r.workspace_id,
  fromKind: r.from_kind,
  toKind: r.to_kind,
  thread: r.thread,
  text: r.text,
  createdAt: r.created_at,
  readAt: r.read_at,
  pins: pinIds(r.pins),
});

// Lead-to-lead and chief-to-lead mail. The chief writes as "chief".
export function addLeadMessage(m: {
  workspaceId: string;
  fromKind: LeadKind;
  toKind: LeadKind;
  thread: string;
  text: string;
  // Direction pins of the sender's the text relies on, checked by the caller.
  pins?: number[];
}): LeadMessage {
  const text = m.text.trim().slice(0, TEXT_CAP);
  const thread = m.thread.trim().slice(0, 120);
  if (!text || !thread) throw new Error("A message needs a thread and text");
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO lead_messages (workspace_id, from_kind, to_kind, thread, text, pins)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      m.workspaceId,
      m.fromKind,
      m.toKind,
      thread,
      text,
      m.pins?.length ? JSON.stringify(m.pins) : null
    );
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

export function getLeadMessage(id: number): LeadMessage | null {
  const r = db.prepare(`SELECT * FROM lead_messages WHERE id = ?`).get(id) as
    Row | undefined;
  return r ? view(r) : null;
}

export function markOneRead(id: number): void {
  db.prepare(
    `UPDATE lead_messages SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL`
  ).run(id);
}

const PAIR = `((from_kind = @a AND to_kind = @b) OR (from_kind = @b AND to_kind = @a))`;

// A thread between two leads, up to one of its messages (all of it
// without), newest last; with how many it has in all and after that one.
export function threadUpTo(q: {
  workspaceId: string;
  thread: string;
  a: LeadKind;
  b: LeadKind;
  upToId: number | null;
  limit: number;
}): {
  messages: LeadMessage[];
  total: number;
  later: number;
  // Who opened the thread, and to whom.
  opened: { from: LeadKind; to: LeadKind } | null;
} {
  const params = {
    w: q.workspaceId,
    thread: q.thread,
    a: q.a,
    b: q.b,
    upTo: q.upToId ?? Number.MAX_SAFE_INTEGER,
    limit: q.limit,
  };
  const { total, later } = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(id > @upTo), 0) AS later
       FROM lead_messages WHERE workspace_id = @w AND thread = @thread AND ${PAIR}`
    )
    .get(params) as { total: number; later: number };
  const messages = (
    db
      .prepare(
        `SELECT * FROM (SELECT * FROM lead_messages
           WHERE workspace_id = @w AND thread = @thread AND ${PAIR} AND id <= @upTo
           ORDER BY id DESC LIMIT @limit) ORDER BY id`
      )
      .all(params) as Row[]
  ).map(view);
  const first = db
    .prepare(
      `SELECT from_kind, to_kind FROM lead_messages
       WHERE workspace_id = @w AND thread = @thread AND ${PAIR} ORDER BY id LIMIT 1`
    )
    .get(params) as { from_kind: string; to_kind: string } | undefined;
  const opened = first ? { from: first.from_kind, to: first.to_kind } : null;
  return { messages, total, later, opened };
}

// The threads between two leads (either way), newest first: one open
// thread per topic is found here by its name.
export function threadsBetween(
  workspaceId: string,
  a: LeadKind,
  b: LeadKind
): string[] {
  return (
    db
      .prepare(
        `SELECT thread FROM lead_messages
         WHERE workspace_id = ? AND ((from_kind = ? AND to_kind = ?) OR (from_kind = ? AND to_kind = ?))
         GROUP BY thread ORDER BY MAX(id) DESC`
      )
      .all(workspaceId, a, b, b, a) as { thread: string }[]
  ).map((r) => r.thread);
}

// Sent on a thread between two leads, either way, since a time: the loop
// guard's count.
export function pairSentSince(
  workspaceId: string,
  a: LeadKind,
  b: LeadKind,
  thread: string,
  sinceSqlite: string
): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM lead_messages
         WHERE workspace_id = ? AND thread = ? AND created_at >= ?
           AND ((from_kind = ? AND to_kind = ?) OR (from_kind = ? AND to_kind = ?))`
      )
      .get(workspaceId, thread, sinceSqlite, a, b, b, a) as { n: number }
  ).n;
}
