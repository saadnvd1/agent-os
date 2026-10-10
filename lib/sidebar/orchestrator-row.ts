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

// The workspaces shown that have no orchestrator yet, each offered as a
// "Start orchestrator" row. One that exists but was unpinned isn't missing.
// Like the orchestrator row, none show under a chosen project.
export function orchestratorsToStart(
  overviews: readonly { workspaceId: string; sessionId: string | null }[],
  scope: {
    workspaces: readonly { id: string; name: string }[];
    workspaceId: string | null;
    projectId: string | null;
    query: string;
  }
): { workspaceId: string; name: string }[] {
  if (scope.projectId) return [];
  const q = scope.query.trim().toLowerCase();
  const missing = new Set(
    overviews.filter((o) => !o.sessionId).map((o) => o.workspaceId)
  );
  return scope.workspaces
    .filter(
      (w) =>
        missing.has(w.id) &&
        (!scope.workspaceId || w.id === scope.workspaceId) &&
        (!q || `${w.name} orchestrator`.toLowerCase().includes(q))
    )
    .map((w) => ({ workspaceId: w.id, name: w.name }));
}
