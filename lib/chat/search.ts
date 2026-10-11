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

// Kinds the timeline never shows, skipped without parsing.
const UNSHOWN = ["task", "turn_end", "mcp", "compacted", "undo"];

const EMPTY: SearchResult = {
  total: 0,
  capped: false,
  hits: [],
  cursor: null,
  hasMore: false,
};

// A LIKE pattern for the query as it's stored inside the item's JSON.
function likePattern(query: string): string | null {
  // LIKE folds case for ASCII only: anything else is matched in full below.
  if (/[^\x00-\x7f]/.test(query)) return null;
  const json = JSON.stringify(query).slice(1, -1);
  return `%${json.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Case-insensitive search of one conversation's stored items, including
 * pages not loaded, folded steps and tool output. Rows are narrowed by SQL
 * on their stored JSON, then matched on what each row shows (lib/chat/find).
 * Returns positions and snippets, a page of items at a time, never bodies.
 */
export function searchChat(
  sessionId: string,
  query: string,
  before: number | null = null,
  limit = SEARCH_PAGE
): SearchResult {
  const q = query.trim().slice(0, MAX_QUERY);
  if (q.length < MIN_QUERY) return EMPTY;
  const like = likePattern(q);
  const rows = db
    .prepare(
      `SELECT seq, data FROM chat_items
       WHERE session_id = ? AND (kind IS NULL OR kind NOT IN (${UNSHOWN.map(() => "?").join(",")}))
       ${like ? `AND data LIKE ? ESCAPE '\\'` : ""}
       ORDER BY seq DESC`
    )
    .iterate(sessionId, ...UNSHOWN, ...(like ? [like] : [])) as Iterable<{
    seq: number;
    data: string;
  }>;

  const result: SearchResult = { ...EMPTY, hits: [] };
  const from = before ?? Number.MAX_SAFE_INTEGER;
  for (const row of rows) {
    const item = JSON.parse(row.data) as ChatItem;
    const text = findableText(item);
    const at = occurrences(text, q);
    if (!at.length) continue;
    result.total += at.length;
    if (row.seq < from) {
      if (result.hits.length < limit)
        result.hits.push({
          id: item.id,
          seq: row.seq,
          count: at.length,
          snippet: snippetAt(text, at[0], q.length),
        });
      else result.hasMore = true;
    }
    if (result.total >= MAX_MATCHES) {
      result.capped = true;
      result.hasMore ||= result.hits.length >= limit;
      break;
    }
  }
  result.cursor = result.hits.at(-1)?.seq ?? null;
  return result;
}
