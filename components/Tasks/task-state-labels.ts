import type { Tone } from "@/lib/config/client-config-types";
import type { TaskState } from "@/lib/tasks/state";
import { TASK_STATE_LABELS } from "@/lib/tasks/state-labels";

export const TONE_TEXT: Record<Tone, string> = {
  muted: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  primary: "text-primary",
  destructive: "text-destructive",
  success: "text-emerald-600 dark:text-emerald-400",
};

// How a task's state reads, and its tone class, wherever a task is shown.
export const TASK_STATE = Object.fromEntries(
  Object.entries(TASK_STATE_LABELS).map(([k, v]) => [
    k,
    { label: v.label, tone: TONE_TEXT[v.tone] },
  ])
) as Record<TaskState, { label: string; tone: string }>;
