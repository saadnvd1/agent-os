// How a task's state reads, and its tone, wherever a task is shown. Synced to
// the native app, so it may only import synced files.
import type { Tone } from "../config/client-config-types";
import type { TaskState } from "./state";

export const TASK_STATE_LABELS: Record<
  TaskState,
  { label: string; tone: Tone }
> = {
  working: { label: "Working", tone: "muted" },
  "needs-input": { label: "Needs input", tone: "warning" },
  blocked: { label: "Blocked", tone: "warning" },
  "plan-ready": { label: "Plan ready", tone: "primary" },
  review: { label: "Ready for review", tone: "primary" },
  "checks-failing": { label: "Checks failing", tone: "destructive" },
  exited: { label: "Agent exited", tone: "warning" },
  merged: { label: "Merged", tone: "success" },
  dropped: { label: "Dropped", tone: "muted" },
  done: { label: "Done", tone: "success" },
  moving: { label: "Moving", tone: "warning" },
};
