import { getDb, type Session } from "./db";
import type { ChatItem, ChatState } from "./chat/events";
import { openAskCount } from "./orchestrator/asks";
import type { SessionNeed } from "./sidebar/shelves";

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
// have already seen is just idle. An orchestrator works on its own, so only
// a card waiting on you or an open ask on its list counts: finishing a turn
// is routine for it.
export function needsYou(
  session: Pick<Session, "id" | "view" | "updated_at" | "last_seen_at"> &
    Partial<Pick<Session, "role" | "workspace_id">>,
  chatState: ChatState | null
): boolean {
  const seen = sqliteMs(session.last_seen_at);
  if (session.view === "chat") {
    if (chatState === "waiting") return true;
    if (session.role === "orchestrator")
      return openAskCount(session.workspace_id) > 0;
    const latest = latestChatItem(session.id);
    return latest?.kind === "turn_end" && latest.createdAt > seen;
  }
  // A terminal session's updated_at moves when it starts waiting.
  return sqliteMs(session.updated_at) > seen;
}

type SeenFields = Pick<Session, "id" | "view" | "updated_at" | "last_seen_at">;

function pendingApproval(
  sessionId: string
): Extract<ChatItem, { kind: "approval" }> | null {
  const row = getDb()
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ?
         AND json_extract(data, '$.kind') = 'approval'
         AND json_extract(data, '$.status') = 'pending'
       ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { data: string } | undefined;
  return row
    ? (JSON.parse(row.data) as Extract<ChatItem, { kind: "approval" }>)
    : null;
}

// Why a chat is blocked on you, if it is: an approval, a question, an
// orchestrator's open asks, or a turn that ended in an error.
export function chatNeed(
  session: Pick<Session, "id"> & Partial<Pick<Session, "role">>,
  state: ChatState | null,
  asks = 0
): SessionNeed | null {
  if (session.role === "orchestrator")
    return asks > 0 || state === "waiting" ? "answer" : null;
  if (state === "waiting")
    return pendingApproval(session.id)?.questions?.length
      ? "answer"
      : "approve";
  if (state === "error") return "failed";
  return null;
}

// Finished or changed since the reader last opened it.
export function isUnread(
  session: SeenFields,
  chatState: ChatState | null
): boolean {
  const seen = sqliteMs(session.last_seen_at);
  if (session.view === "chat") {
    if (chatState === "running" || chatState === "waiting") return false;
    const latest = latestChatItem(session.id);
    return latest?.kind === "turn_end" && latest.createdAt > seen;
  }
  return sqliteMs(session.updated_at) > seen;
}

// A terminal's row in the status map. Waiting counts only when it's news,
// not a prompt you've seen; a live terminal is never unread.
export function terminalStatus<S extends string>(
  row: SeenFields | undefined,
  status: S
): { status: S | "idle"; need: SessionNeed | null; unread: boolean } {
  const terminal = row ? { ...row, view: "terminal" as const } : null;
  const shown =
    status === "waiting" && terminal && !needsYou(terminal, null)
      ? "idle"
      : status;
  return {
    status: shown,
    need: shown === "waiting" ? "input" : null,
    unread:
      shown !== "running" &&
      shown !== "waiting" &&
      !!terminal &&
      isUnread(terminal, null),
  };
}
