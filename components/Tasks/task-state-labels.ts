import type { TaskState } from "@/lib/tasks/state";

// How a task's state reads, and its tone, wherever a task is shown.
export const TASK_STATE: Record<TaskState, { label: string; tone: string }> = {
  working: { label: "Working", tone: "text-muted-foreground" },
  "needs-input": {
    label: "Needs input",
    tone: "text-amber-600 dark:text-amber-400",
  },
  blocked: { label: "Blocked", tone: "text-amber-600 dark:text-amber-400" },
  "plan-ready": { label: "Plan ready", tone: "text-primary" },
  review: { label: "Ready for review", tone: "text-primary" },
  "checks-failing": { label: "Checks failing", tone: "text-destructive" },
  exited: { label: "Agent exited", tone: "text-amber-600 dark:text-amber-400" },
  merged: { label: "Merged", tone: "text-emerald-600 dark:text-emerald-400" },
  dropped: { label: "Dropped", tone: "text-muted-foreground/60" },
  done: { label: "Done", tone: "text-emerald-600 dark:text-emerald-400" },
  moving: { label: "Moving", tone: "text-amber-600 dark:text-amber-400" },
};
