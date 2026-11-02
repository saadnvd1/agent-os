export type ChildState =
  "queued" | "starting" | "running" | "needs_input" | "settled";

export type ChildOutcome = "ok" | "failed" | "cancelled";

// `implicit`: the child's turn ended without `aos return`, so its final
// answer stands in (kept apart so stats can tell them).
export type ResultKind = "explicit" | "implicit";

export interface GroupRow {
  id: string;
  parent_session_id: string;
  request_id: string;
  started_by: "agent" | "user";
  context: "fork" | "brief";
  delivery: "wake" | "next";
  fork_item_id: string | null;
  created_at: number;
  last_settled_at: number | null;
}

export interface ChildRow {
  child_session_id: string;
  parent_session_id: string;
  group_id: string;
  position: number;
  label: string;
  instruction: string;
  worktree: number;
  state: ChildState;
  hold: string | null;
  outcome: ChildOutcome | null;
  summary: string | null;
  result: string | null;
  result_kind: ResultKind | null;
  fell_back: number;
  cut_message_id: string | null;
  idle_since: number | null;
  started_at: number | null;
  settled_at: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cache_read: number | null;
  heavy_runs: number;
  delivered_at: number | null;
  delivery_id: string | null;
  used: "opened" | "mentioned" | null;
  created_at: number;
}

// What a client shows for one child.
export interface ChildView {
  id: string;
  n: number;
  group: string;
  label: string;
  instruction: string;
  state: ChildState;
  hold: string | null;
  outcome: ChildOutcome | null;
  summary: string | null;
  resultKind: ResultKind | null;
  worktree: boolean;
  fellBack: boolean;
  startedAt: number | null;
  settledAt: number | null;
  delivered: boolean;
  // A question or approval it's waiting on.
  asks: string | null;
}

export interface GroupView {
  id: string;
  delivery: "wake" | "next";
  context: "fork" | "brief";
  startedBy: "agent" | "user";
  createdAt: number;
  stats: string | null;
}
