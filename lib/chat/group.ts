import type { ChatItem } from "./events";

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type UndoItem = Extract<ChatItem, { kind: "undo" }>;

export type TimelineBlock =
  | { type: "item"; item: ChatItem }
  | { type: "tools"; id: string; tools: ToolItem[] }
  | { type: "undone"; id: string; undo: UndoItem; items: ChatItem[] };

// Tools worth seeing on their own rather than as one step among many.
export const STANDALONE_TOOLS = new Set(["Skill", "Task", "Agent"]);

// Consecutive tool calls (and the reasoning between them) fold into one
// collapsible block, so a long turn reads as what was said, not every step.
// Undone messages fold into one block behind the undo that took them back.
export function groupTimeline(items: ChatItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let tools: ToolItem[] = [];
  const flush = () => {
    if (tools.length) blocks.push({ type: "tools", id: tools[0].id, tools });
    tools = [];
  };
  const ends = undoneRanges(items);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const end = ends.get(i);
    if (end !== undefined) {
      flush();
      blocks.push({
        type: "undone",
        id: items[end].id,
        undo: items[end] as UndoItem,
        items: items.slice(i, end),
      });
      i = end;
    } else if (item.kind === "tool" && STANDALONE_TOOLS.has(item.name)) {
      flush();
      blocks.push({ type: "item", item });
    } else if (item.kind === "tool") {
      tools.push(item);
    } else if (item.kind === "reasoning" && tools.length) {
      continue;
    } else if (
      item.kind === "approval" &&
      item.status !== "pending" &&
      !(item.status === "answered" && item.questions)
    ) {
      // A settled approval is told by the tool call it let through (or not).
      continue;
    } else {
      flush();
      blocks.push({ type: "item", item });
    }
  }
  flush();
  return blocks;
}

// Start index -> index of the undo that ends it, with overlapping undos
// (going back further after going back once) merged into one range.
function undoneRanges(items: ChatItem[]): Map<number, number> {
  const index = new Map(items.map((item, i) => [item.id, i]));
  const ranges: [number, number][] = [];
  items.forEach((item, end) => {
    if (item.kind !== "undo") return;
    const start = index.get(item.from);
    if (start !== undefined && start < end) ranges.push([start, end]);
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return new Map(merged);
}
