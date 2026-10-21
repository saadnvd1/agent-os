import type { ChatItem } from "../chat/events";
import { BadShare } from "../share/service";
import type { ExportRange } from "./view";

export interface Turn {
  /** 1-based; 0 is whatever came before the first message. */
  n: number;
  items: ChatItem[];
}

/**
 * Items (already `visible()`, in stored order) as turns. A turn is a user
 * message and everything until the next one; a message sent while the agent
 * was working stays inside the turn it landed in.
 */
export function groupTurns(items: ChatItem[]): Turn[] {
  const turns: Turn[] = [];
  let n = 0;
  for (const item of items) {
    const starts = item.kind === "user" && !item.midTurn;
    if (starts) {
      n++;
      turns.push({ n, items: [] });
    } else if (turns.length === 0) {
      turns.push({ n: 0, items: [] });
    }
    turns[turns.length - 1].items.push(item);
  }
  return turns;
}

type Numbered = { n: number; items: { kind: string }[] };

export const turnCount = (turns: Numbered[]) =>
  turns.filter((t) => t.n > 0).length;

/** The inclusive turn numbers a range means, within 1..of. Throws BadShare. */
export function resolveRange(
  turns: Numbered[],
  range: ExportRange | undefined
): { from: number; to: number; of: number } {
  const of = turnCount(turns);
  if (!range || of === 0) return { from: 1, to: Math.max(of, 1), of };
  if ("last" in range) {
    const k = Math.max(1, Math.min(of, Math.floor(range.last)));
    return { from: of - k + 1, to: of, of };
  }
  if ("sinceCompaction" in range) {
    let at = 0;
    for (const t of turns)
      if (t.items.some((i) => i.kind === "compacted")) at = Math.max(t.n, 1);
    return { from: at || 1, to: of, of };
  }
  const { from, to } = range;
  if (from < 1 || from > of)
    throw new BadShare(`range starts at turn ${from}, there are ${of}`, 400);
  if (to < from) throw new BadShare("range ends before it starts", 400);
  return { from, to: Math.min(to, of), of };
}

/** Turn 0 (the start) rides along with a range that begins at turn 1. */
export const inRange = (n: number, sel: { from: number; to: number }) =>
  n === 0 ? sel.from <= 1 : n >= sel.from && n <= sel.to;
