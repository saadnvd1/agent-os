// What the health watcher knows and says. Plain data, no I/O: the detectors
// are pure functions of HealthFacts, and a trip is what one returns.

export const AREAS = ["scheduler", "pipeline", "tasks"] as const;
export type Area = (typeof AREAS)[number];

export const AREA_LABELS: Record<Area, string> = {
  scheduler: "Scheduler",
  pipeline: "Pipeline",
  tasks: "Tasks",
};

export const CHECKS = [
  "load-red",
  "queue-held",
  "bg-quiet",
  "bg-spin",
  "piece-dup",
  "restarts",
  "ci-slow",
  "armed-stuck",
  "server-errors",
] as const;
export type CheckId = (typeof CHECKS)[number];

export const AREA_OF: Record<CheckId, Area> = {
  "load-red": "scheduler",
  "queue-held": "scheduler",
  "bg-quiet": "tasks",
  "bg-spin": "tasks",
  "piece-dup": "pipeline",
  restarts: "pipeline",
  "ci-slow": "pipeline",
  "armed-stuck": "pipeline",
  "server-errors": "pipeline",
};

// High can only be reached from warn while an anomaly is open.
export type Severity = "warn" | "high";

export interface Trip {
  check: CheckId;
  // What it is about: a machine, queue row, session and task, PR, piece or
  // "server". One open anomaly per check and subject.
  subject: string;
  severity: Severity;
  line: string;
  detail: Record<string, unknown>;
  workspaceId: string | null;
}

export interface MachineFact {
  id: string;
  label: string;
  level: "green" | "amber" | "red" | null;
  // When it turned red, if it still is.
  redSince: number | null;
  load1?: number;
  cores?: number;
}

export interface QueueFact {
  id: string;
  name: string | null;
  projectId: string;
  workspaceId: string | null;
  createdAt: number;
  // Why it hasn't started, in words.
  heldBy: string;
}

export interface BgFact {
  sessionId: string;
  sessionName: string;
  workspaceId: string | null;
  taskId: string;
  description: string;
  startedAt: number;
  // Null when the task has printed nothing at all.
  outputAt: number | null;
}

export interface ArmedFact {
  sessionId: string;
  name: string;
  workspaceId: string | null;
  armedAt: number;
  prNumber: number | null;
}

export interface CiFact {
  projectId: string;
  workspaceId: string | null;
  prNumber: number;
  head: string;
  pendingSince: number;
  // Settled durations of this project's recent runs, ms.
  baseline: number[];
}

export interface HealthFacts {
  now: number;
  machines: MachineFact[];
  queue: QueueFact[];
  bg: BgFact[];
  armed: ArmedFact[];
  ci: CiFact[];
  // Server start times inside the restart window.
  boots: number[];
  // Autodeploy's planned restarts inside the same window.
  deploys: number[];
  errors: { recent: number; baselineMean: number };
}

export interface Verdict {
  real: boolean;
  cause: string;
  action: string;
  saadOnly: boolean;
  // Said by the model, so shown as its word, never as a fact.
  probe?: string | null;
  note?: string | null;
  // Set when no model judged it, and why.
  unjudged?: boolean;
  why?: string | null;
}

export interface AnomalyRow {
  id: number;
  check_id: CheckId;
  subject: string;
  area: Area;
  severity: Severity;
  line: string;
  detail: string;
  workspace_id: string | null;
  opened_at: number;
  last_seen_at: number;
  closed_at: number | null;
  close_reason: string | null;
  muted_until: number | null;
  hits: number;
  woken_severity: Severity | null;
  woken_at: number | null;
  verdict: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  delivered_at: number | null;
  phoned_at: number | null;
}

export const MIN = 60 * 1000;
