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

// Moves an item after every other, as if first written now.
export function moveToEnd(sessionId: string, itemId: string): void {
  db.prepare(
    `UPDATE chat_items SET seq = (SELECT MAX(seq) + 1 FROM chat_items WHERE session_id = ?)
     WHERE session_id = ? AND item_id = ?`
  ).run(sessionId, sessionId, itemId);
}

export function listItems(sessionId: string): ChatItem[] {
  return (
    db
      .prepare(`SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq`)
      .all(sessionId) as { data: string }[]
  ).map((r) => JSON.parse(r.data) as ChatItem);
}

export function getItem(
  sessionId: string,
  itemId: string
): ChatItem | undefined {
  const row = db
    .prepare(`SELECT data FROM chat_items WHERE session_id = ? AND item_id = ?`)
    .get(sessionId, itemId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChatItem) : undefined;
}

export function hasItem(sessionId: string, itemId: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM chat_items WHERE session_id = ? AND item_id = ?`)
    .get(sessionId, itemId);
}

// The latest `n` items, oldest first; of one kind when `kind` is given.
export function lastItems(
  sessionId: string,
  n: number,
  kind?: ChatItem["kind"]
): ChatItem[] {
  const rows = (
    kind
      ? db
          .prepare(
            `SELECT data FROM chat_items WHERE session_id = ?
             AND json_extract(data, '$.kind') = ? ORDER BY seq DESC LIMIT ?`
          )
          .all(sessionId, kind, n)
      : db
          .prepare(
            `SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq DESC LIMIT ?`
          )
          .all(sessionId, n)
  ) as { data: string }[];
  return rows.reverse().map((r) => JSON.parse(r.data) as ChatItem);
}

export function itemsOfKind<K extends ChatItem["kind"]>(
  sessionId: string,
  kind: K
): Extract<ChatItem, { kind: K }>[] {
  return (
    db
      .prepare(
        `SELECT data FROM chat_items WHERE session_id = ?
         AND json_extract(data, '$.kind') = ? ORDER BY seq`
      )
      .all(sessionId, kind) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}

// Tool calls saved as still running.
export function runningTools(
  sessionId: string
): Extract<ChatItem, { kind: "tool" }>[] {
  return (
    db
      .prepare(
        `SELECT data FROM chat_items WHERE session_id = ?
         AND json_extract(data, '$.kind') = 'tool'
         AND json_extract(data, '$.status') = 'running'`
      )
      .all(sessionId) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
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
  const item = JSON.parse(row.data) as {
    text?: unknown;
    peer?: { body?: unknown };
  };
  const text =
    typeof item.peer?.body === "string"
      ? item.peer.body
      : typeof item.text === "string"
        ? item.text
        : "";
  const line = text.trim().split("\n")[0];
  return line ? (line.length > 80 ? `${line.slice(0, 79)}…` : line) : null;
}
