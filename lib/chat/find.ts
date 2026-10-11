/**
 * Find in a conversation: what text each item lets a reader find (what its
 * row shows once opened), where a match sits in it, and which rows to open to
 * show it. Shared by the server's search and the panel's find bar, so both
 * count the same matches.
 */

import type { ChatItem } from "./events";
import { lineDiff } from "./diff";
import { groupTimeline, STANDALONE_TOOLS, type ToolItem } from "./group";
import { eventParts, originOf } from "./origin";

export const MIN_QUERY = 2;
export const MAX_QUERY = 200;

// Whether `query` could be in a diff at all, before paying for lineDiff.
const inDiff = (diff: NonNullable<ToolItem["diff"]>, query: string) => {
  const q = query.toLowerCase();
  return (
    diff.before.toLowerCase().includes(q) ||
    diff.after.toLowerCase().includes(q)
  );
};

function toolText(tool: ToolItem, query?: string): string {
  if (tool.name === "Skill") return tool.title;
  const input = (tool.input ?? {}) as Record<string, unknown>;
  if (STANDALONE_TOOLS.has(tool.name))
    return [tool.title, input.prompt, tool.output].filter(Boolean).join("\n");
  const parts = [tool.title];
  if (tool.diff && query !== undefined && !inDiff(tool.diff, query))
    parts.push(tool.diff.path);
  else if (tool.diff)
    parts.push(
      tool.diff.path,
      ...lineDiff(tool.diff.before, tool.diff.after).map((l) => l.text)
    );
  else {
    parts.push(
      tool.name === "Bash" && typeof input.command === "string"
        ? input.command
        : JSON.stringify(tool.input, null, 2)
    );
    if (tool.output) parts.push(tool.output);
  }
  return parts.join("\n");
}

// What a reader can find in an item: its row's text, opened. Nothing for
// items the timeline doesn't show. With `query`, a diff it can't be in is
// left out rather than laid out line by line.
export function findableText(item: ChatItem, query?: string): string {
  switch (item.kind) {
    case "user": {
      const origin = originOf(item);
      if (!origin) return item.text;
      const { body, decided } = eventParts(item, origin);
      return [...decided, body].join("\n");
    }
    case "assistant":
    case "reasoning":
    case "command_output":
    case "note":
      return item.text;
    case "plan":
      return item.plan;
    case "error":
      return item.message;
    case "todos":
      return item.todos.map((t) => t.text).join("\n");
    case "artifact":
      return item.title;
    case "approval":
      // A settled one is told by its tool call (lib/chat/group).
      if (
        item.status !== "pending" &&
        !(item.status === "answered" && item.questions)
      )
        return "";
      return [item.title, ...(item.questions ?? []).map((q) => q.question)]
        .filter(Boolean)
        .join("\n");
    case "tool":
      return toolText(item, query);
    default:
      return "";
  }
}

// Where `query` occurs in `text`, case-insensitively and not overlapping.
export function occurrences(text: string, query: string): number[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const at: number[] = [];
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length))
    at.push(i);
  return at;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

// A line's worth around a match, for a result list or a log.
export function snippetAt(
  text: string,
  at: number,
  length: number,
  around = 40
): Snippet {
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const start = Math.max(0, at - around);
  const end = Math.min(text.length, at + length + around);
  return {
    before: (start > 0 ? "…" : "") + flat(text.slice(start, at)).trimStart(),
    match: flat(text.slice(at, at + length)),
    after:
      flat(text.slice(at + length, end)).trimEnd() +
      (end < text.length ? "…" : ""),
  };
}

export interface SearchHit {
  id: string;
  seq: number;
  // Matches in this item, in the order its row shows them.
  count: number;
  snippet: Snippet;
}

export interface SearchResult {
  // Matches in the whole conversation, up to MAX_MATCHES.
  total: number;
  capped: boolean;
  // Items with a match, newest first, older than the asked-for cursor.
  hits: SearchHit[];
  // The oldest hit's position: the next page asks from before it.
  cursor: number | null;
  hasMore: boolean;
}

export interface Located {
  // The timeline block to scroll to.
  block: string;
  // Row states to open, outermost first (components/Chat/rowState).
  open: string[];
}

function rowKeys(item: ChatItem): string[] {
  if (item.kind === "reasoning") return [`reasoning:${item.id}`];
  if (item.kind === "tool" && STANDALONE_TOOLS.has(item.name))
    return item.name === "Skill" ? [] : [`agent:${item.id}`];
  if (item.kind === "user") {
    const origin = originOf(item);
    if (!origin) return [];
    const { decided } = eventParts(item, origin);
    return [
      `event:${item.id}`,
      ...decided.map((_, i) => `event:${item.id}:${i}`),
    ];
  }
  return [];
}

/**
 * Which block of the loaded timeline shows an item, and which rows to open
 * so it's on screen: a step inside its folded run, a message inside an undo.
 * Null when it isn't loaded (or the timeline never shows it).
 */
export function locate(items: ChatItem[], id: string): Located | null {
  const at = items.findIndex((i) => i.id === id);
  if (at === -1) return null;
  const inside = (
    blocks: ReturnType<typeof groupTimeline>,
    open: string[]
  ): Omit<Located, "block"> | null => {
    for (const b of blocks) {
      if (b.type === "item" && b.item.id === id)
        return { open: [...open, ...rowKeys(b.item)] };
      if (b.type === "tools" && b.tools.some((t) => t.id === id))
        return { open: [...open, `steps:${b.id}`, `tool:${id}`] };
      if (b.type === "undone" && b.items.some((i) => i.id === id))
        return (
          inside(groupTimeline(b.items), [...open, `undone:${b.undo.id}`]) ?? {
            open: [...open, `undone:${b.undo.id}`],
          }
        );
    }
    return null;
  };
  const blocks = groupTimeline(items);
  const blockOf = (b: (typeof blocks)[number]) =>
    b.type === "item" ? b.item.id : b.id;
  for (const b of blocks) {
    const found = inside([b], []);
    if (found) return { block: blockOf(b), ...found };
  }
  // Reasoning between steps folds out of sight: the run it sits in.
  for (let i = at - 1; i >= 0; i--) {
    const before = items[i];
    if (before.kind !== "tool") continue;
    const run = blocks.find(
      (b) => b.type === "tools" && b.tools.some((t) => t.id === before.id)
    );
    if (run) return { block: blockOf(run), open: [`steps:${blockOf(run)}`] };
    break;
  }
  return null;
}

// One match to go to: the item, and which of its matches (in its own order).
export interface FindTarget {
  id: string;
  n: number;
}

// Results newest first, as the reader meets them scrolling up from the end:
// an item's last match before its first.
export function flattenHits(hits: SearchHit[]): FindTarget[] {
  return hits.flatMap((h) =>
    Array.from({ length: h.count }, (_, i) => ({
      id: h.id,
      n: h.count - 1 - i,
    }))
  );
}

/**
 * Where next (+1, older) or previous (-1, newer) goes from `index` among
 * `loaded` results: "more" when the next is on a page not fetched yet. It
 * wraps around only once every result is loaded.
 */
export function stepIndex(
  index: number,
  dir: 1 | -1,
  loaded: number,
  hasMore: boolean
): number | "more" {
  if (!loaded) return 0;
  const next = index + dir;
  if (next >= loaded) return hasMore ? "more" : 0;
  if (next < 0) return hasMore ? 0 : loaded - 1;
  return next;
}
