import { db } from "../db";
import type { ChatItem } from "./events";
import {
  findableText,
  MAX_QUERY,
  MIN_QUERY,
  occurrences,
  snippetAt,
  type SearchResult,
} from "./find";

// Items per page of results, newest first.
export const SEARCH_PAGE = 50;
// Past this many matches the count stops and says so.
export const MAX_MATCHES = 5000;
// Stored JSON one request reads at most: a search runs on the event loop,
// so a huge conversation is searched a slice at a time, never all at once.
export const MAX_SCAN_BYTES = 16 * 1024 * 1024;

// Kinds the timeline never shows, skipped without parsing.
const UNSHOWN = ["task", "turn_end", "mcp", "compacted", "undo"];

const EMPTY: SearchResult = {
  total: 0,
  capped: false,
  hits: [],
  cursor: null,
  hasMore: false,
};

// A LIKE pattern for the query as it's stored inside the item's JSON, or
// null when it could miss what a row shows: LIKE folds case for ASCII only,
// and quotes and backslashes are escaped in the JSON but shown plain (a
// tool's input is shown pretty-printed). Those queries read every row.
function likePattern(query: string): string | null {
  if (/[^\x00-\x7f]|["\\]/.test(query)) return null;
  return `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Case-insensitive search of one conversation's stored items, including
 * pages not loaded, folded steps and tool output. Rows are narrowed by SQL
 * on their stored JSON, then matched on what each row shows (lib/chat/find).
 * Returns positions and snippets, a page of items at a time, never bodies.
 *
 * The first page (no `before`) also counts every match; later pages only
 * find their items. No request reads more than MAX_SCAN_BYTES: past it the
 * count is a floor (`capped`) and the next page carries on from there.
 */
export function searchChat(
  sessionId: string,
  query: string,
  before: number | null = null,
  limit = SEARCH_PAGE,
  maxBytes = MAX_SCAN_BYTES
): SearchResult {
  const q = query.trim().slice(0, MAX_QUERY);
  if (q.length < MIN_QUERY) return EMPTY;
  const like = likePattern(q);
  const rows = db
    .prepare(
      `SELECT seq, data FROM chat_items
       WHERE session_id = ? AND seq < ?
       AND (kind IS NULL OR kind NOT IN (${UNSHOWN.map(() => "?").join(",")}))
       ${like ? `AND data LIKE ? ESCAPE '\\'` : ""}
       ORDER BY seq DESC`
    )
    .iterate(
      sessionId,
      before ?? Number.MAX_SAFE_INTEGER,
      ...UNSHOWN,
      ...(like ? [like] : [])
    ) as Iterable<{ seq: number; data: string }>;

  const result: SearchResult = { ...EMPTY, hits: [] };
  let counting = before === null;
  let bytes = 0;
  let scanned: number | null = null;
  let stopped = false;
  for (const row of rows) {
    if (scanned !== null && bytes + row.data.length > maxBytes) {
      stopped = true;
      result.capped ||= counting;
      break;
    }
    bytes += row.data.length;
    scanned = row.seq;
    const item = JSON.parse(row.data) as ChatItem;
    const text = findableText(item, q);
    const at = occurrences(text, q);
    if (!at.length) continue;
    if (result.hits.length < limit)
      result.hits.push({
        id: item.id,
        seq: row.seq,
        count: at.length,
        snippet: snippetAt(text, at[0], q.length),
      });
    else result.hasMore = true;
    if (counting) {
      result.total += at.length;
      if (result.total >= MAX_MATCHES) {
        result.capped = true;
        counting = false;
      }
    }
    // Nothing left to count and the page is full: older ones are next page's.
    if (!counting && result.hits.length >= limit) {
      stopped = true;
      break;
    }
  }
  const full = result.hits.length >= limit;
  result.hasMore ||= stopped;
  result.cursor = full ? result.hits[limit - 1].seq : scanned;
  return result;
}
