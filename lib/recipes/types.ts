// Recipes: a saved brief that starts a fresh task or session each run.

export const RECIPE_KINDS = ["task", "session"] as const;
export type RecipeKind = (typeof RECIPE_KINDS)[number];

export const MAX_BRIEF = 4000;
export const MAX_NOTE = 1000;
export const MAX_NAME = 80;

export interface Recipe {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  kind: RecipeKind;
  brief: string;
  // "provider/model", or a JSON role map (see lib/models); null: the defaults.
  model: string | null;
  view: "chat" | "terminal";
  auto_done: boolean;
  max_minutes: number | null;
  carry_cleared_at: number | null;
  source_session_id: string | null;
  created_by_session_id: string | null;
  updated_by_session_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const RUN_TRIGGERS = [
  "manual",
  "tool",
  "cli",
  "timer",
  "catch-up",
] as const;
export type RunTriggerKind = (typeof RUN_TRIGGERS)[number];

export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "timed_out"
  | "cancelled"
  | "skipped";

export const LIVE_STATUSES: RunStatus[] = ["queued", "starting", "running"];
export const isLive = (s: RunStatus) => LIVE_STATUSES.includes(s);

export interface RecipeRun {
  id: number;
  recipe_id: string;
  seq: number;
  trigger: RunTriggerKind;
  triggered_by_session_id: string | null;
  schedule_run_id: number | null;
  request_id: string | null;
  note: string | null;
  prompt: string;
  revision_id: number | null;
  status: RunStatus;
  session_id: string | null;
  pr_number: number | null;
  pr_url: string | null;
  summary: string | null;
  outputs: Record<string, string> | null;
  summary_source: "line" | "model" | "state" | null;
  error: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface RecipeInput {
  workspaceId: string;
  projectId: string;
  name: string;
  kind: RecipeKind;
  brief: string;
  model?: string | null;
  view?: "chat" | "terminal";
  autoDone?: boolean;
  maxMinutes?: number | null;
  sourceSessionId?: string | null;
}

export interface RecipeTimer {
  scheduleId: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  description: string;
  nextRunAt: number | null;
}

export interface RecipeTotals {
  runs: number;
  succeeded: number;
  failed: number;
  costUsd: number;
  avgMs: number | null;
}

export interface RecipeView extends Recipe {
  projectName: string | null;
  lastRun: RecipeRun | null;
  liveRun: RecipeRun | null;
  timer: RecipeTimer | null;
  totals: RecipeTotals;
}
