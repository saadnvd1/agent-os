import { db } from "../db";
import type { LiveLevel } from "./types";

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
  level: LiveLevel;
  /** 1: guests get the chat from before the link was made. */
  history: number;
  /** The access code in plain text, or null when off. Never logged. */
  access_code: string | null;
}

export type LogKind =
  | "join_request"
  | "admit"
  | "deny"
  | "kick"
  | "suggestion"
  | "sent"
  | "dismissed"
  | "level"
  // The code was turned on, off or changed; the log never holds the code.
  | "code_changed"
  // Drive: who holds the wheel (guest_id, ref = the wheel's own id; both
  // null when taken back), a prompt they sent (ref = its id), and why a
  // Drive's turn or queue was stopped (ref = the reason).
  | "wheel"
  | "drive_prompt"
  | "drive_stopped";

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
       (id, session_id, title, url, ends_with_session, max_guests, created_at, expires_at, ended_at, level, history, access_code)
     VALUES (@id, @session_id, @title, @url, @ends_with_session, @max_guests, @created_at, @expires_at, @ended_at, @level, @history, @access_code)`
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

export function setLevel(id: string, level: LiveLevel): void {
  db.prepare(`UPDATE live_shares SET level = ? WHERE id = ?`).run(level, id);
  logLive({
    share_id: id,
    kind: "level",
    guest_id: null,
    guest_name: null,
    ref: level,
    text: null,
    sent_text: null,
  });
}

export function setAccessCode(id: string, code: string | null): void {
  db.prepare(`UPDATE live_shares SET access_code = ? WHERE id = ?`).run(
    code,
    id
  );
  logLive({
    share_id: id,
    kind: "code_changed",
    guest_id: null,
    guest_name: null,
    ref: code ? "on" : "off",
    text: null,
    sent_text: null,
  });
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
    else if (l.kind === "kick" || l.kind === "deny") out.delete(l.guest_id);
  }
  return out;
}

/** Who holds the wheel, from the log: a kick or a level other than Drive drops it. */
export function wheelOf(
  shareId: string
): { guestId: string; wheel: string } | null {
  let w: { guestId: string; wheel: string } | null = null;
  for (const l of listLog(shareId)) {
    if (l.kind === "wheel")
      w = l.guest_id && l.ref ? { guestId: l.guest_id, wheel: l.ref } : null;
    else if (l.kind === "level" && l.ref !== "drive") w = null;
    else if (
      (l.kind === "kick" || l.kind === "deny") &&
      l.guest_id === w?.guestId
    )
      w = null;
  }
  return w;
}

/** Whether a Drive prompt with this id was ever logged for the share. */
export function hasDrivePrompt(shareId: string, ref: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM live_share_log WHERE share_id = ? AND kind = 'drive_prompt' AND ref = ? LIMIT 1`
    )
    .get(shareId, ref);
}

/** Whether a suggestion with this id was ever logged for the share. */
export function hasSuggestion(shareId: string, ref: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM live_share_log WHERE share_id = ? AND kind = 'suggestion' AND ref = ? LIMIT 1`
    )
    .get(shareId, ref);
}

/** Whether a join request from this guest was already logged. */
export function hasJoinRequest(shareId: string, guestId: string): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM live_share_log WHERE share_id = ? AND kind = 'join_request' AND guest_id = ? LIMIT 1`
    )
    .get(shareId, guestId);
}
