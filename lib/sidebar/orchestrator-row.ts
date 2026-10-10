// What the pinned orchestrator row says: its state with the workspace's
// running and in-review counts, and Saad's open asks. Client-safe.
import type { SidebarRow } from "./shelves";

export interface OrchestratorRowCounts {
  asks: number;
  paused: boolean;
  running: number;
  inReview: number;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function orchestratorRowText(
  row: Pick<SidebarRow, "need" | "working">,
  c: OrchestratorRowCounts
): { status: string; asks: string | null } {
  const state = c.paused
    ? "Paused"
    : row.need === "failed"
      ? "Failed"
      : row.working
        ? "Working"
        : "Idle";
  const status = [
    state,
    c.running > 0 && `${c.running} running`,
    c.inReview > 0 && `${c.inReview} in review`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { status, asks: c.asks > 0 ? plural(c.asks, "ask") : null };
}
