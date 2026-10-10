import { db } from "../db";
import type { ChatItem } from "./events";

// The message a conversation whose turn was cut off is sent, once.
export const RESUME_PREFIX = "user-resume-";
export const RESUME_NOTE =
  "AgentOS restarted while you were working; your last step was interrupted. Check its state and continue.";

// What a turn writes as it goes. A user item alone isn't one: a local
// command (/mcp) is recorded as one and answered with no turn at all.
const WORK_KINDS = new Set(["assistant", "reasoning", "tool"]);

// A turn cut off: after the last turn_end the agent did some work, or a
// message was taken and nothing followed it, and the turn never wrote its
// own turn_end. Its last item names the interruption, so the same one is
// never resumed twice. Null when the last turn ended, when its last item is
// older than `since`, or when what was cut off is already a resume (it isn't
// resumed in a loop).
export function cutOffTurn(
  sessionId: string,
  since = 0
): { last: string; resumeId: string; again: boolean } | null {
  const rows = (
    db
      .prepare(
        `SELECT item_id, data FROM chat_items WHERE session_id = ?
         AND seq > COALESCE((SELECT MAX(seq) FROM chat_items
                             WHERE session_id = ? AND kind = 'turn_end'), 0)
         ORDER BY seq`
      )
      .all(sessionId, sessionId) as { item_id: string; data: string }[]
  ).map((r) => JSON.parse(r.data) as ChatItem);
  const newest = rows.at(-1);
  if (!newest || newest.createdAt < since) return null;
  const turn = rows.filter((i) => i.kind === "user" || WORK_KINDS.has(i.kind));
  if (!rows.some((i) => WORK_KINDS.has(i.kind)) && newest.kind !== "user")
    return null;
  const last = turn.at(-1)!;
  return {
    last: last.id,
    resumeId: `${RESUME_PREFIX}${last.id}`,
    again: turn.some((i) => i.id.startsWith(RESUME_PREFIX)),
  };
}

// Chats whose newest item is from after `since` and whose last turn was
// cut off. (A session's updated_at moves only when a turn starts, so a long
// turn would be missed by it.)
export function cutOffSessions(since: number): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM sessions s WHERE view = 'chat' AND archived_at IS NULL
       AND host_id = 'local'
       AND (SELECT json_extract(data, '$.createdAt') FROM chat_items
            WHERE session_id = s.id ORDER BY seq DESC LIMIT 1) >= ?`
    )
    .all(since) as { id: string }[];
  return rows
    .map((r) => r.id)
    .filter((id) => {
      try {
        return cutOffTurn(id, since);
      } catch (error) {
        console.error(`Not checking ${id} for a cut-off turn:`, error);
        return false;
      }
    });
}
