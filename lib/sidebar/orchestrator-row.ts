// What the pinned orchestrator row says: its state with the workspace's
// running, in-review and queued counts, and Saad's open asks. Client-safe.
import type { SidebarRow } from "./shelves";

export interface OrchestratorRowCounts {
  asks: number;
  paused: boolean;
  running: number;
  inReview: number;
  queued: number;
}

export type OrchestratorState =
  | "Paused"
  | "Failed"
  | "Working"
  | "Replied"
  | "Waiting"
  | "Idle";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Working is mid-turn; Replied, a reply Saad hasn't seen; Waiting, idle
// while the workspace still has work in flight; Idle, nothing at all.
export function orchestratorState(
  row: Pick<SidebarRow, "need" | "working" | "unread">,
  c: OrchestratorRowCounts
): OrchestratorState {
  if (c.paused) return "Paused";
  if (row.need === "failed") return "Failed";
  if (row.working) return "Working";
  if (row.unread) return "Replied";
  if (c.running + c.inReview + c.queued > 0) return "Waiting";
  return "Idle";
}

export function orchestratorRowText(
  row: Pick<SidebarRow, "need" | "working" | "unread">,
  c: OrchestratorRowCounts
): { state: OrchestratorState; status: string; asks: string | null } {
  const state = orchestratorState(row, c);
  const status = [
    state,
    c.running > 0 && `${c.running} running`,
    c.inReview > 0 && `${c.inReview} in review`,
    c.queued > 0 && `${c.queued} queued`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { state, status, asks: c.asks > 0 ? plural(c.asks, "ask") : null };
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
