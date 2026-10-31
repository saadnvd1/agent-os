import { db } from "../db";
import { MAX_VIEWS, type ChatView, type ChatViewInput } from "./types";

interface Row {
  session_id: string;
  item_id: string | null;
  offset_px: number;
  at_end: number;
  viewed_at: number;
}

const toView = (r: Row): ChatView => ({
  sessionId: r.session_id,
  itemId: r.item_id,
  offsetPx: r.offset_px,
  atEnd: r.at_end === 1,
  viewedAt: r.viewed_at,
});

/** The most recently viewed chats first. */
export function listChatViews(limit = MAX_VIEWS): ChatView[] {
  return (
    db
      .prepare(`SELECT * FROM chat_views ORDER BY viewed_at DESC LIMIT ?`)
      .all(limit) as Row[]
  ).map(toView);
}

/** Saves where the reader is. Without a position it only marks the chat as
 * viewed now (opening it), keeping what was saved. */
export function saveChatView(
  sessionId: string,
  input: ChatViewInput | null,
  now = Date.now()
): ChatView {
  if (input) {
    db.prepare(
      `INSERT INTO chat_views (session_id, item_id, offset_px, at_end, viewed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET item_id = excluded.item_id,
         offset_px = excluded.offset_px, at_end = excluded.at_end,
         viewed_at = CASE WHEN ? = 1 THEN excluded.viewed_at
                          ELSE chat_views.viewed_at END`
    ).run(
      sessionId,
      input.itemId,
      input.offsetPx,
      input.atEnd ? 1 : 0,
      now,
      input.advance ? 1 : 0
    );
  } else {
    db.prepare(
      `INSERT INTO chat_views (session_id, viewed_at) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET viewed_at = excluded.viewed_at`
    ).run(sessionId, now);
  }
  return toView(
    db
      .prepare(`SELECT * FROM chat_views WHERE session_id = ?`)
      .get(sessionId) as Row
  );
}

export function deleteChatView(sessionId: string): void {
  db.prepare(`DELETE FROM chat_views WHERE session_id = ?`).run(sessionId);
}
