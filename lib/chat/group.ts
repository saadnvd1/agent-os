import type { ChatItem, TurnEndReason } from "./events";
import { readingOrder } from "./reading-order";
import { stepCounts, type StepCounts } from "./tool-outcome";
import { eventTurnAt, type EventTurn } from "./turns";

// Ends that stop a turn mid-task: they show how many steps got done.
const CUT_SHORT = new Set<TurnEndReason>([
  "error",
  "stalled",
  "compaction_empty",
  "cut_off",
]);

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type UndoItem = Extract<ChatItem, { kind: "undo" }>;

export type TimelineBlock =
  // `steps` rides on the end of a stopped or failed turn: what ran in it.
  | { type: "item"; item: ChatItem; steps?: StepCounts }
  | { type: "tools"; id: string; tools: ToolItem[] }
  | { type: "undone"; id: string; undo: UndoItem; items: ChatItem[] }
  // Consecutive turns an event started, with the reply to each.
  | { type: "events"; id: string; turns: EventTurn[] };

export interface GroupOptions {
  // Fold events and the replies to them (the orchestrator's chat).
  foldEvents?: boolean;
}

// Tools worth seeing on their own rather than as one step among many.
export const STANDALONE_TOOLS = new Set(["Skill", "Task", "Agent"]);

// Consecutive tool calls (and the reasoning between them) fold into one
// collapsible block, so a long turn reads as what was said, not every step.
// Undone messages fold into one block behind the undo that took them back.
export function groupTimeline(
  all: ChatItem[],
  opts: GroupOptions = {}
): TimelineBlock[] {
  const items = opts.foldEvents ? readingOrder(all) : all;
  const blocks: TimelineBlock[] = [];
  let tools: ToolItem[] = [];
  // Every tool call since the last turn ended, grouped or not.
  let turnTools: ToolItem[] = [];
  const flush = () => {
    if (tools.length) blocks.push({ type: "tools", id: tools[0].id, tools });
    tools = [];
  };
  let turns: EventTurn[] = [];
  const flushTurns = () => {
    if (turns.length)
      blocks.push({ type: "events", id: `ev-${turns[0].id}`, turns });
    turns = [];
  };
  const ends = undoneRanges(items);
  // Where the next undone range starts: a turn stops short of it.
  const starts = [...ends.keys()].sort((a, b) => a - b);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const end = ends.get(i);
    if (opts.foldEvents && end === undefined && item.kind === "user") {
      const limit = starts.find((s) => s > i) ?? items.length;
      const found = eventTurnAt(items, i, limit);
      if (found) {
        flush();
        turns.push(found.turn);
        i = found.end - 1;
        continue;
      }
    }
    // What the timeline never shows doesn't break a run of events.
    const hidden =
      item.kind === "task" ||
      (item.kind === "approval" &&
        item.status !== "pending" &&
        !(item.status === "answered" && item.questions));
    if (!hidden) flushTurns();
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
      turnTools.push(item);
      blocks.push({ type: "item", item });
    } else if (item.kind === "tool") {
      turnTools.push(item);
      tools.push(item);
    } else if (item.kind === "reasoning" && tools.length) {
      continue;
    } else if (item.kind === "task") {
      // Background work is listed by the composer, not in the conversation.
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
      const cut =
        item.kind === "turn_end" &&
        (item.interrupted ||
          (item.ended !== undefined && CUT_SHORT.has(item.ended.reason)));
      blocks.push(
        cut && turnTools.length
          ? { type: "item", item, steps: stepCounts(turnTools) }
          : { type: "item", item }
      );
      if (item.kind === "turn_end") turnTools = [];
    }
  }
  flush();
  flushTurns();
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

// Whether a block would render the same as before: items keep their identity
// until they change, so a streamed delta re-renders only its own block.
export function sameBlock(a: TimelineBlock, b: TimelineBlock): boolean {
  if (a === b) return true;
  if (a.type === "item" && b.type === "item")
    return (
      a.item === b.item &&
      a.steps?.total === b.steps?.total &&
      a.steps?.ok === b.steps?.ok &&
      a.steps?.failed === b.steps?.failed
    );
  if (a.type === "tools" && b.type === "tools")
    return sameItems(a.tools, b.tools);
  if (a.type === "undone" && b.type === "undone")
    return a.undo === b.undo && sameItems(a.items, b.items);
  if (a.type === "events" && b.type === "events")
    return (
      a.id === b.id &&
      a.turns.length === b.turns.length &&
      a.turns.every(
        (t, i) =>
          t.user === b.turns[i].user &&
          t.live === b.turns[i].live &&
          sameItems(t.replies, b.turns[i].replies)
      )
    );
  return false;
}

function sameItems(a: readonly ChatItem[], b: readonly ChatItem[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
