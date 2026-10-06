import { db } from "../db";
import type { ChatItem } from "./events";

// Items keep the position they were first written at, so replacing one
// (a finished tool call, a streamed message's final text) never reorders.
export function saveItem(sessionId: string, item: ChatItem): void {
  db.prepare(
    `INSERT INTO chat_items (session_id, item_id, seq, data)
     VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_items WHERE session_id = ?), ?)
     ON CONFLICT(session_id, item_id) DO UPDATE SET data = excluded.data`
  ).run(sessionId, item.id, sessionId, JSON.stringify(item));
}

export function listItems(sessionId: string): ChatItem[] {
  return (
    db
      .prepare(`SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq`)
      .all(sessionId) as { data: string }[]
  ).map((r) => JSON.parse(r.data) as ChatItem);
}

export function deleteItems(sessionId: string): void {
  db.prepare(`DELETE FROM chat_items WHERE session_id = ?`).run(sessionId);
}

// With no live conversation, nothing is still streaming or running: those
// items were cut off (AgentOS restarted, or the agent was stopped).
export function settle(items: ChatItem[]): ChatItem[] {
  return items.map((item) => {
    if (
      (item.kind === "assistant" || item.kind === "reasoning") &&
      item.streaming
    ) {
      return { ...item, streaming: false };
    }
    if (item.kind === "tool" && item.status === "running") {
      return { ...item, status: "stopped" };
    }
    if (item.kind === "approval" && item.status === "pending") {
      return { ...item, status: "expired" };
    }
    if (item.kind === "task" && item.status === "running") {
      return { ...item, status: "stopped" };
    }
    return item;
  });
}

// What a chat session is working on: the first line of its latest message.
export function lastUserTask(sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ? AND item_id LIKE 'user-%'
       ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { data: string } | undefined;
  if (!row) return null;
  const text = (JSON.parse(row.data) as { text?: string }).text ?? "";
  const line = text.trim().split("\n")[0];
  return line ? (line.length > 80 ? `${line.slice(0, 79)}…` : line) : null;
}
