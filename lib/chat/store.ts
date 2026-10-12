import { db } from "../db";
import type { ChatItem } from "./events";

// Items keep the position they were first written at, so replacing one
// (a finished tool call, a streamed message's final text) never reorders.
export function saveItem(sessionId: string, item: ChatItem): void {
  flushItems();
  db.prepare(
    `INSERT INTO chat_items (session_id, item_id, seq, data)
     VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_items WHERE session_id = ?), ?)
     ON CONFLICT(session_id, item_id) DO UPDATE SET data = excluded.data`
  ).run(sessionId, item.id, sessionId, JSON.stringify(item));
  seqs.delete(sessionId);
}

// The streaming path. Every update of an item is a write, so they're held
// in memory (the latest state of each item) and written together, in one
// transaction, every FLUSH_MS. Callers flush at anything that mustn't be
// lost: an item finishing, a turn ending, an error, an interrupt, a close.
// Every reader here flushes first; one that queries the table itself may be
// up to FLUSH_MS behind.
export const FLUSH_MS = 250;

type Pending = { seq: number; data: string };
type Seqs = { next: number; of: Map<string, number> };

const pending = new Map<string, Map<string, Pending>>();
const seqs = new Map<string, Seqs>();
let timer: NodeJS.Timeout | undefined;

// Seeded once from the table, then kept: an item gets its seq the first
// time it's seen, the same one it would have got from MAX(seq) + 1.
function seqsOf(sessionId: string): Seqs {
  let s = seqs.get(sessionId);
  if (!s) {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(seq), 0) AS m FROM chat_items WHERE session_id = ?`
      )
      .get(sessionId) as { m: number };
    s = { next: row.m + 1, of: new Map() };
    seqs.set(sessionId, s);
  }
  return s;
}

export function queueItem(
  sessionId: string,
  item: ChatItem,
  { flush = false }: { flush?: boolean } = {}
): void {
  const s = seqsOf(sessionId);
  let seq = s.of.get(item.id);
  if (seq === undefined) {
    seq = s.next++;
    s.of.set(item.id, seq);
  }
  let items = pending.get(sessionId);
  if (!items) pending.set(sessionId, (items = new Map()));
  items.set(item.id, { seq, data: JSON.stringify(item) });
  if (flush) flushItems();
  else if (!timer) {
    timer = setTimeout(flushItems, FLUSH_MS);
    timer.unref();
  }
}

export function flushItems(): void {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.size) return;
  try {
    const insert = db.prepare(
      `INSERT INTO chat_items (session_id, item_id, seq, data) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, item_id) DO UPDATE SET data = excluded.data`
    );
    db.transaction(() => {
      for (const [sessionId, items] of pending)
        for (const [itemId, p] of items)
          insert.run(sessionId, itemId, p.seq, p.data);
    })();
    pending.clear();
  } catch (error) {
    // Kept for the next try rather than lost.
    console.error("Chat items not written:", error);
    timer = setTimeout(flushItems, FLUSH_MS);
    timer.unref();
  }
}

// Moves an item after every other, as if first written now.
export function moveToEnd(sessionId: string, itemId: string): void {
  flushItems();
  db.prepare(
    `UPDATE chat_items SET seq = (SELECT MAX(seq) + 1 FROM chat_items WHERE session_id = ?)
     WHERE session_id = ? AND item_id = ?`
  ).run(sessionId, sessionId, itemId);
  seqs.delete(sessionId);
}

export function listItems(sessionId: string): ChatItem[] {
  flushItems();
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
  flushItems();
  const row = db
    .prepare(`SELECT data FROM chat_items WHERE session_id = ? AND item_id = ?`)
    .get(sessionId, itemId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as ChatItem) : undefined;
}

export function hasItem(sessionId: string, itemId: string): boolean {
  flushItems();
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
  flushItems();
  const rows = (
    kind
      ? db
          .prepare(
            `SELECT data FROM chat_items WHERE session_id = ?
             AND kind = ? ORDER BY seq DESC LIMIT ?`
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

// What the agent has said since the last message to it, as text: where a
// chat task's BLOCKED: line stays until someone answers it.
export function saidSinceLastMessage(sessionId: string, n = 20): string {
  flushItems();
  const items = lastItems(sessionId, n);
  return items
    .slice(items.findLastIndex((i) => i.kind === "user") + 1)
    .map((i) => (i.kind === "assistant" ? i.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function itemsOfKind<K extends ChatItem["kind"]>(
  sessionId: string,
  kind: K
): Extract<ChatItem, { kind: K }>[] {
  flushItems();
  return (
    db
      .prepare(
        `SELECT data FROM chat_items WHERE session_id = ?
         AND kind = ? ORDER BY seq`
      )
      .all(sessionId, kind) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}

// A chat's background tasks still running, or ended after `since` (ms): what
// the composer lists, read without parsing the rest of a long conversation.
export function recentTasks(
  sessionId: string,
  since: number
): Extract<ChatItem, { kind: "task" }>[] {
  flushItems();
  return (
    db
      .prepare(
        `SELECT data FROM chat_items WHERE session_id = ? AND kind = 'task'
         AND (json_extract(data, '$.status') = 'running'
              OR COALESCE(json_extract(data, '$.endedAt'),
                          json_extract(data, '$.createdAt')) > ?)
         ORDER BY seq DESC LIMIT 200`
      )
      .all(sessionId, since) as { data: string }[]
  )
    .reverse()
    .map((r) => JSON.parse(r.data));
}

// Items of a kind saved as still running, read from the running index.
export function runningItems<K extends "tool" | "task">(
  sessionId: string,
  kind: K
): Extract<ChatItem, { kind: K }>[] {
  flushItems();
  return (
    db
      .prepare(
        `SELECT data FROM chat_items WHERE session_id = ?
         AND kind = ? AND json_extract(data, '$.status') = 'running'
         ORDER BY seq`
      )
      .all(sessionId, kind) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}

// Tool calls saved as still running.
export const runningTools = (sessionId: string) =>
  runningItems(sessionId, "tool");

export function deleteItems(sessionId: string): void {
  pending.delete(sessionId);
  seqs.delete(sessionId);
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
  flushItems();
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
