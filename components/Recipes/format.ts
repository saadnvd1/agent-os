import type { RecipeRun, RunStatus } from "@/lib/recipes/types";

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  blocked: "Needs you",
  timed_out: "Timed out",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

export const STATUS_TONE: Record<RunStatus, string> = {
  queued: "bg-foreground/10 text-muted-foreground",
  starting: "bg-primary/15 text-primary",
  running: "bg-primary/15 text-primary",
  succeeded: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  timed_out: "bg-destructive/15 text-destructive",
  cancelled: "bg-foreground/10 text-muted-foreground",
  skipped: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

// SQLite's datetime('now') is UTC without a zone marker.
export const sqlMs = (t: string | null) =>
  t ? Date.parse(`${t.replace(" ", "T")}Z`) : 0;

export function duration(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const money = (n: number | null) =>
  n == null ? "" : `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

const TRIGGER_LABEL = {
  manual: "by hand",
  tool: "by the orchestrator",
  cli: "by an agent",
  timer: "on its timer",
  "catch-up": "on its timer, late",
} as const;

export const triggerLabel = (r: Pick<RecipeRun, "trigger">) =>
  TRIGGER_LABEL[r.trigger];
