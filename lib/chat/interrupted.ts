import { db } from "../db";
import type { ChatItem } from "./events";

// The message a conversation whose turn was cut off is sent, once.
export const RESUME_PREFIX = "user-resume-";
export const RESUME_NOTE =
  "AgentOS restarted while you were working; your last step was interrupted. Check its state and continue.";

// What a turn writes as it goes; anything else (an undo, /mcp's list) can
// follow a finished turn without one running.
const TURN_KINDS = ["user", "assistant", "reasoning", "tool"];

// A turn cut off: it wrote something after the last turn_end, and never
// wrote its own. Its last item names the interruption, so the same one is
// never resumed twice. Null when the last turn ended, or when what was cut
// off is already a resume (it isn't resumed in a loop).
export function cutOffTurn(
  sessionId: string,
  since = 0
): { last: string; resumeId: string; again: boolean } | null {
  const rows = db
    .prepare(
      `SELECT item_id, data FROM chat_items WHERE session_id = ?
       AND seq > COALESCE((SELECT MAX(seq) FROM chat_items
                           WHERE session_id = ? AND kind = 'turn_end'), 0)
       AND kind IN (${TURN_KINDS.map(() => "?").join(", ")})
       ORDER BY seq`
    )
    .all(sessionId, sessionId, ...TURN_KINDS) as {
    item_id: string;
    data: string;
  }[];
  const last = rows.at(-1);
  if (!last) return null;
  const item = JSON.parse(last.data) as ChatItem;
  if (item.createdAt < since) return null;
  return {
    last: last.item_id,
    resumeId: `${RESUME_PREFIX}${last.item_id}`,
    again: rows.some((r) => r.item_id.startsWith(RESUME_PREFIX)),
  };
}

// Chats active since `since` whose last turn was cut off.
export function cutOffSessions(since: number): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM sessions WHERE view = 'chat' AND archived_at IS NULL AND host_id = 'local'
       AND updated_at >= ?`
    )
    .all(new Date(since).toISOString().replace("T", " ").slice(0, 19)) as {
    id: string;
  }[];
  return rows.map((r) => r.id).filter((id) => cutOffTurn(id, since));
}
