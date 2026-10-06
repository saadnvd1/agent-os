import { getDb, type Session } from "./db";
import type { ChatItem, ChatState } from "./chat/events";

// SQLite datetime('now') is UTC without a zone marker.
const sqliteMs = (t: string | null | undefined) =>
  t ? Date.parse(`${t.replace(" ", "T")}Z`) || 0 : 0;

export function markSeen(sessionId: string): void {
  getDb()
    .prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .run(sessionId);
}

function latestChatItem(sessionId: string): ChatItem | null {
  const row = getDb()
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChatItem) : null;
}

// A session needs you when it's blocked on you (an approval or a question),
// or it finished something you haven't looked at since. A live session you
// have already seen is just idle.
export function needsYou(
  session: Pick<Session, "id" | "view" | "updated_at" | "last_seen_at">,
  chatState: ChatState | null
): boolean {
  const seen = sqliteMs(session.last_seen_at);
  if (session.view === "chat") {
    if (chatState === "waiting") return true;
    const latest = latestChatItem(session.id);
    return latest?.kind === "turn_end" && latest.createdAt > seen;
  }
  // A terminal session's updated_at moves when it starts waiting.
  return sqliteMs(session.updated_at) > seen;
}
