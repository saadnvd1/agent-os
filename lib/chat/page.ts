import { db } from "../db";
import type { ChatItem, ToolBody } from "./events";

// A conversation opens on its latest items and pages older ones in as the
// reader scrolls up, so a long one costs what's on screen, not its history.
export const PAGE_ITEMS = 75;
export const PAGE_BYTES = 1024 * 1024;

export interface ItemPage {
  items: ChatItem[];
  // The position of the oldest item sent; older pages ask from before it.
  cursor: number | null;
  hasMore: boolean;
}

interface Row {
  seq: number;
  data: string;
}

// A tool call without its output and diff: those load when it's opened.
export function lighten(item: ChatItem): ChatItem {
  if (item.kind !== "tool" || (item.output === undefined && !item.diff))
    return item;
  const { output, diff, ...rest } = item;
  return {
    ...rest,
    deferred: true,
    ...(diff ? { hasDiff: true } : {}),
    ...(output ? { hasOutput: true } : {}),
  };
}

function parse(row: Row): { seq: number; item: ChatItem; bytes: number } {
  const item = lighten(JSON.parse(row.data) as ChatItem);
  const bytes =
    item.kind === "tool" && item.deferred
      ? JSON.stringify(item).length
      : row.data.length;
  return { seq: row.seq, item, bytes };
}

/**
 * The latest items before `before` (a cursor from an earlier page), up to
 * `limit` items or `maxBytes`, always at least one. An undo on the page brings
 * the messages it took back with it, so the page can fold them.
 */
export function readPage(
  sessionId: string,
  before: number | null = null,
  limit = PAGE_ITEMS,
  maxBytes = PAGE_BYTES
): ItemPage {
  const rows = db
    .prepare(
      `SELECT seq, data FROM chat_items WHERE session_id = ? AND seq < ?
       ORDER BY seq DESC`
    )
    .iterate(sessionId, before ?? Number.MAX_SAFE_INTEGER) as Iterable<Row>;
  const page: { seq: number; item: ChatItem }[] = [];
  let bytes = 0;
  for (const row of rows) {
    const next = parse(row);
    if (page.length >= limit || (page.length && bytes + next.bytes > maxBytes))
      break;
    page.push(next);
    bytes += next.bytes;
  }
  page.reverse();

  for (;;) {
    const oldest = page[0]?.seq;
    if (oldest === undefined) break;
    const ids = new Set(page.map((p) => p.item.id));
    const reach = page
      .map((p) => (p.item.kind === "undo" ? p.item.from : null))
      .filter((from): from is string => !!from && !ids.has(from))
      .map(
        (from) =>
          (
            db
              .prepare(
                `SELECT seq FROM chat_items WHERE session_id = ? AND item_id = ?`
              )
              .get(sessionId, from) as { seq: number } | undefined
          )?.seq
      )
      .filter((seq): seq is number => seq !== undefined && seq < oldest);
    if (!reach.length) break;
    const extra = (
      db
        .prepare(
          `SELECT seq, data FROM chat_items WHERE session_id = ?
           AND seq >= ? AND seq < ? ORDER BY seq`
        )
        .all(sessionId, Math.min(...reach), oldest) as Row[]
    ).map(parse);
    page.unshift(...extra);
  }

  const cursor = page[0]?.seq ?? null;
  const hasMore =
    cursor !== null &&
    !!db
      .prepare(`SELECT 1 FROM chat_items WHERE session_id = ? AND seq < ?`)
      .get(sessionId, cursor);
  return { items: page.map((p) => p.item), cursor, hasMore };
}

// A tool call's output and diff, for one opened from a page.
export function toolBody(sessionId: string, itemId: string): ToolBody | null {
  const row = db
    .prepare(`SELECT data FROM chat_items WHERE session_id = ? AND item_id = ?`)
    .get(sessionId, itemId) as { data: string } | undefined;
  if (!row) return null;
  const item = JSON.parse(row.data) as ChatItem;
  if (item.kind !== "tool") return null;
  return { output: item.output, diff: item.diff };
}
