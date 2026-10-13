// A session's last sign of life, in ms: its row, its tmux pane, its chat.

import { db, type Session } from "../db";
import { statusDetector } from "../status-detector";

export const sqliteMs = (t: string | null | undefined) =>
  t ? Date.parse(`${t.replace(" ", "T")}Z`) || 0 : 0;

export function latestChatAt(sessionId: string): number {
  const row = db
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { data: string } | undefined;
  return row
    ? ((JSON.parse(row.data) as { createdAt?: number }).createdAt ?? 0)
    : 0;
}

export const lastActiveOf = (s: Session): number =>
  Math.max(
    sqliteMs(s.updated_at),
    statusDetector.getTimestamp(s.tmux_name) * 1000,
    latestChatAt(s.id)
  );
