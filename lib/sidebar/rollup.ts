// What an orchestrator started, counted from the same rows the shelves show:
// blocked is a row on Needs you, in review a task state, running a working
// row, queued an item in the Queued shelf. Client-safe.
import type { QueuedRow } from "./queued";
import type { Shelves, SidebarRow } from "./shelves";

export interface Rollup {
  running: number;
  inReview: number;
  blocked: number;
  queued: number;
}

const flatten = (rows: SidebarRow[]): SidebarRow[] =>
  rows.flatMap((r) => [r, ...flatten(r.workers), ...flatten(r.quick ?? [])]);

export function rollups(
  shelves: Shelves,
  queued: readonly Pick<QueuedRow, "item">[]
): Map<string, Rollup> {
  const out = new Map<string, Rollup>();
  const of = (id: string) => {
    let r = out.get(id);
    if (!r)
      out.set(id, (r = { running: 0, inReview: 0, blocked: 0, queued: 0 }));
    return r;
  };
  const rows = flatten([
    ...shelves.orchestrators,
    ...shelves.pinned,
    ...shelves.needsYou,
    ...shelves.working,
    ...shelves.inReview,
    ...shelves.ongoing,
    ...shelves.snoozed,
    ...shelves.done,
  ]);
  for (const row of rows) {
    const by = row.session.started_by;
    if (!by) continue;
    const r = of(by);
    if (row.need) r.blocked++;
    else if (row.task === "review") r.inReview++;
    else if (row.working) r.running++;
  }
  for (const { item } of queued)
    if (item.startedBy && item.status !== "failed") of(item.startedBy).queued++;
  return out;
}

export const rollupChips = [
  { key: "running", label: "running", dot: "bg-green-500" },
  { key: "inReview", label: "in review", dot: "bg-primary" },
  { key: "blocked", label: "blocked", dot: "bg-amber-500" },
  { key: "queued", label: "queued", dot: "bg-muted-foreground/35" },
] as const;

// The chips to draw: zero counts are left out.
export function visibleChips(r: Rollup | undefined) {
  return r ? rollupChips.filter((c) => r[c.key] > 0) : [];
}
