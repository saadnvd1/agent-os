// The developer-analyst loop: types shared by the engine, the routes and
// the browser (no Node modules here).

export const CRITERION_STATUSES = ["open", "failing", "met", "waived"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const CRITERION_SOURCES = ["card", "brief", "plan", "user"] as const;
export type CriterionSource = (typeof CRITERION_SOURCES)[number];

export const EVIDENCE_KINDS = ["test", "diff", "typecheck", "ci"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Evidence {
  kind: EvidenceKind;
  ref: string;
  note: string;
}

export interface Criterion {
  id: number;
  loopId: string;
  position: number;
  text: string;
  source: CriterionSource;
  evidenceKind: EvidenceKind | null;
  status: CriterionStatus;
  evidence: Evidence | null;
  // False when the analyst said "met" but the citation didn't resolve.
  verified: boolean;
  metCycle: number | null;
  waivedBy: string | null;
}

export interface CriterionDraft {
  text: string;
  source?: CriterionSource;
  evidenceKind?: EvidenceKind | null;
}

export type LoopState = "running" | "stopped";

export const STOP_REASONS = [
  "stopped",
  "blocked",
  "done",
  "repeat",
  "no_progress",
  "limit:cycles",
  "limit:cost",
  "limit:time",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface Limits {
  maxCycles: number;
  maxCostUsd: number;
  maxMinutes: number;
  graceSeconds: number;
  stallCycles: number;
  repeatCycles: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxCycles: 8,
  maxCostUsd: 15,
  maxMinutes: 180,
  graceSeconds: 30,
  stallCycles: 3,
  repeatCycles: 3,
};

export const LIMIT_BOUNDS = {
  maxCycles: [1, 30],
  maxCostUsd: [1, 200],
  maxMinutes: [10, 24 * 60],
  graceSeconds: [0, 300],
  stallCycles: [2, 10],
  repeatCycles: [2, 10],
} as const satisfies Record<keyof Limits, readonly [number, number]>;

export interface LoopRow extends Limits {
  id: string;
  sessionId: string;
  workspaceId: string | null;
  state: LoopState;
  stopReason: StopReason | null;
  stopDetail: string | null;
  goal: string;
  costBaseUsd: number;
  startedAt: number;
  endedAt: number | null;
  lastCycleAt: number | null;
  runNow: boolean;
}

export type CycleTrigger = "turn_end" | "ci" | "review" | "manual";

// Where a cycle is. The steps before "decided" are redone after a restart;
// "sending" is safe to redo because the message goes by a fixed id.
export type CycleState =
  | "claimed"
  | "decided"
  | "counting"
  | "sending"
  | "sent"
  | "skipped"
  | "stopped"
  | "superseded"
  | "error";

export type Sender = "analyst" | "user";

export interface Finding {
  severity: "blocking" | "minor";
  file?: string;
  line?: number;
  text: string;
}

export interface Analysis {
  summary: string;
  findings: Finding[];
  criteria: {
    id: number;
    status: "met" | "open" | "failing";
    evidence?: Evidence;
  }[];
  next: { instruction: string; focus: number[] } | null;
  blocker: {
    kind:
      | "decision"
      | "credential"
      | "hard-line"
      | "unclear-criteria"
      | "environment";
    text: string;
  } | null;
}

export interface CommandResult {
  name: "typecheck" | "test";
  command: string;
  exitCode: number | null;
  durationMs: number;
  passed: string[];
  failed: string[];
  errors: string[];
  excerpt: string;
  skipped?: string;
}

export interface EvidenceSummary {
  green: boolean;
  commands: CommandResult[];
  ci: { name: string; state: string; sha?: string | null }[];
  note?: string;
}

// The numbers "progress" is judged by: more met criteria, fewer failing
// tests, fewer type errors.
export interface Score {
  met: number;
  failingTests: number;
  typeErrors: number;
}

export interface CycleRow {
  id: number;
  loopId: string;
  n: number;
  trigger: CycleTrigger;
  state: CycleState;
  snapshotSha: string | null;
  tree: string | null;
  changed: boolean;
  evidence: EvidenceSummary | null;
  logPath: string | null;
  analysis: Analysis | null;
  signature: string | null;
  score: Score | null;
  instruction: string | null;
  instructionSent: string | null;
  sender: Sender | null;
  delivery: string | null;
  sendAt: number | null;
  input: string | null;
  costUsd: number;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

// What the loop view shows.
export interface LoopView {
  loop: LoopRow;
  // Why nothing is moving right now, when something is holding it.
  hold: "paused" | "usage-window" | null;
  holdReason: string | null;
  spentUsd: number;
  elapsedMs: number;
  criteria: Criterion[];
  cycles: CycleRow[];
}

// What the pill on a task row shows.
export interface LoopSummary {
  state: LoopState;
  stopReason: StopReason | null;
  cycle: number;
  maxCycles: number;
  met: number;
  total: number;
  hold: "paused" | "usage-window" | null;
}

export class LoopError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message);
  }
}
