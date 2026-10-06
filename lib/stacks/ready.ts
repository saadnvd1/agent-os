// Readiness, ported from dispatch's `stack_ready` and `stack_tick`. Pure:
// item rows in, what to hold and what to start out.

import { itemIds, type StackItemRow } from "../db";
import { itemName } from "./guard";

const HAS_PR = new Set(["pr", "merged"]);
const DEAD = new Set(["failed", "dropped", "held"]);

export const blockersOf = (item: StackItemRow) =>
  itemIds(item.blocker_item_ids);

// Null when every blocker has a PR up (or merged), else what it waits on.
export function waitingOn(
  item: StackItemRow,
  byId: Map<string, StackItemRow>
): string | null {
  const missing = blockersOf(item)
    .map((id) => byId.get(id))
    .filter((b): b is StackItemRow => !!b && !HAS_PR.has(b.status));
  if (!missing.length) return null;
  return `Waits on ${missing.map(itemName).join(", ")}'s PR`;
}

export interface TickPlan {
  hold: Array<{ id: string; note: string }>;
  start: string[];
}

// One look: hold what sits on something dead, then start what is ready,
// at most `max` items working without a PR at once.
export function planTick(items: StackItemRow[], max: number): TickPlan {
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  const hold: TickPlan["hold"] = [];
  const start: string[] = [];
  let inFlight = items.filter(
    (i) => i.status === "running" || i.status === "starting"
  ).length;
  for (const item of byId.values()) {
    if (item.status !== "planned") continue;
    const dead = blockersOf(item)
      .map((id) => byId.get(id))
      .find((b) => b && DEAD.has(b.status));
    if (dead) {
      const note = `${itemName(dead)} is ${dead.status}; it has to be sorted out before this can start`;
      item.status = "held";
      hold.push({ id: item.id, note });
      continue;
    }
    if (waitingOn(item, byId) || inFlight >= max) continue;
    start.push(item.id);
    inFlight += 1;
  }
  return { hold, start };
}
