import { db } from "../db";

export interface LiveShareRow {
  id: string;
  session_id: string;
  title: string;
  url: string;
  ends_with_session: number;
  max_guests: number;
  created_at: string;
  expires_at: string | null;
  ended_at: string | null;
}

export type LogKind =
  | "join_request"
  | "admit"
  | "deny"
  | "kick"
  | "suggestion"
  | "sent"
  | "dismissed";

export interface LogRow {
  id: number;
  share_id: string;
  at: number;
  kind: LogKind;
  guest_id: string | null;
  guest_name: string | null;
  ref: string | null;
  text: string | null;
  sent_text: string | null;
}

export function insertLiveShare(row: LiveShareRow): void {
  db.prepare(
    `INSERT INTO live_shares
       (id, session_id, title, url, ends_with_session, max_guests, created_at, expires_at, ended_at)
     VALUES (@id, @session_id, @title, @url, @ends_with_session, @max_guests, @created_at, @expires_at, @ended_at)`
  ).run(row);
}

export function getLiveShare(id: string): LiveShareRow | undefined {
  return db.prepare(`SELECT * FROM live_shares WHERE id = ?`).get(id) as
    LiveShareRow | undefined;
}

/** Shares this machine still holds: not ended, not past their time. */
export function activeLiveShares(now = Date.now()): LiveShareRow[] {
  return (
    db
      .prepare(
        `SELECT * FROM live_shares WHERE ended_at IS NULL ORDER BY created_at, rowid`
      )
      .all() as LiveShareRow[]
  ).filter((s) => !s.expires_at || Date.parse(s.expires_at) > now);
}

export function activeLiveShareFor(
  sessionId: string,
  now = Date.now()
): LiveShareRow | undefined {
  return activeLiveShares(now).find((s) => s.session_id === sessionId);
}

export function markLiveEnded(id: string): void {
  db.prepare(
    `UPDATE live_shares SET ended_at = COALESCE(ended_at, ?) WHERE id = ?`
  ).run(new Date().toISOString(), id);
}

export function logLive(
  row: Omit<LogRow, "id" | "at"> & { at?: number }
): void {
  db.prepare(
    `INSERT INTO live_share_log (share_id, at, kind, guest_id, guest_name, ref, text, sent_text)
     VALUES (@share_id, @at, @kind, @guest_id, @guest_name, @ref, @text, @sent_text)`
  ).run({ ...row, at: row.at ?? Date.now() });
}

export function listLog(shareId: string): LogRow[] {
  return db
    .prepare(`SELECT * FROM live_share_log WHERE share_id = ? ORDER BY id`)
    .all(shareId) as LogRow[];
}

export interface OpenSuggestion {
  id: string;
  guestId: string;
  guestName: string;
  text: string;
  at: number;
}

/** Suggestions with no sent or dismissed line yet, oldest first. */
export function openSuggestions(shareId: string): OpenSuggestion[] {
  const rows = db
    .prepare(
      `SELECT s.ref, s.guest_id, s.guest_name, s.text, s.at FROM live_share_log s
       WHERE s.share_id = ? AND s.kind = 'suggestion' AND NOT EXISTS (
         SELECT 1 FROM live_share_log d
         WHERE d.share_id = s.share_id AND d.ref = s.ref AND d.kind IN ('sent', 'dismissed'))
       ORDER BY s.id`
    )
    .all(shareId) as {
    ref: string;
    guest_id: string;
    guest_name: string;
    text: string;
    at: number;
  }[];
  return rows.map((r) => ({
    id: r.ref,
    guestId: r.guest_id,
    guestName: r.guest_name,
    text: r.text,
    at: r.at,
  }));
}

/** Guests this machine admitted and has not removed since. */
export function admittedGuestIds(shareId: string): Set<string> {
  const out = new Set<string>();
  for (const l of listLog(shareId)) {
    if (!l.guest_id) continue;
    if (l.kind === "admit") out.add(l.guest_id);
    else if (l.kind === "kick") out.delete(l.guest_id);
  }
  return out;
}
