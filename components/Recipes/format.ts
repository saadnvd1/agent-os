import type { Tone } from "@/lib/config/client-config-types";
import {
  RUN_STATUS_LABELS,
  RUN_TRIGGER_LABELS,
} from "@/lib/recipes/status-labels";
import type { RecipeRun, RunStatus } from "@/lib/recipes/types";

export const STATUS_LABEL = Object.fromEntries(
  Object.entries(RUN_STATUS_LABELS).map(([k, v]) => [k, v.label])
) as Record<RunStatus, string>;

const TONE_CHIP: Record<Tone, string> = {
  muted: "bg-foreground/10 text-muted-foreground",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  primary: "bg-primary/15 text-primary",
  destructive: "bg-destructive/15 text-destructive",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export const STATUS_TONE = Object.fromEntries(
  Object.entries(RUN_STATUS_LABELS).map(([k, v]) => [k, TONE_CHIP[v.tone]])
) as Record<RunStatus, string>;

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

export const triggerLabel = (r: Pick<RecipeRun, "trigger">) =>
  RUN_TRIGGER_LABELS[r.trigger];
