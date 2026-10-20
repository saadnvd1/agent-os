// What the queue's scheduler and timed pause show clients. No imports, so any
// client (the web app, a native one) can share it.

export const PRIORITIES = [
  "urgent",
  "blocking",
  "normal",
  "background",
] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = "normal";

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  blocking: "Blocking",
  normal: "Normal",
  background: "Background",
};

// One line under each choice in the start form.
export const PRIORITY_HINT: Record<Priority, string> = {
  urgent: "A bug you hit: starts first, even on a busy machine",
  blocking: "Something else waits on it",
  normal: "In arrival order",
  background: "Starts last; waits for quiet",
};

export const isPriority = (v: unknown): v is Priority =>
  typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);

// Why a queued task isn't starting; null on the view means it is next.
export type WaitCode =
  | "after"
  | "after_any"
  | "after_claim"
  | "orch_paused"
  | "window"
  | "load_red"
  | "load_amber"
  | "heavy"
  | "spacing"
  | "needs"
  | "slot";

export type PauseState = "pausing" | "paused" | "resuming";
export type PauseBy = "person" | "orchestrator" | "scheduler";

// A paused (or pausing) session as lists show it.
export interface PauseView {
  state: PauseState;
  // When it resumes by itself; null: until someone resumes it.
  until: string | null;
  by: PauseBy;
  reason: string | null;
}

export interface QueueExplainView {
  code: WaitCode | null;
  text: string | null;
  score: number;
  rank: number;
  of: number;
  priority: Priority;
}
