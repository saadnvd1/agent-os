export type SweepKind =
  | "settled"
  | "orphan"
  | "test-leak"
  // What a task left beside its checkout, found by the full clean-up.
  | "database"
  | "spare"
  | "temp"
  | "test-temp"
  | "derived-data";

// Kinds that go only once the full clean-up is turned on.
export const ARMED_KINDS: ReadonlySet<SweepKind> = new Set([
  "test-leak",
  "database",
  "spare",
  "temp",
  "test-temp",
  "derived-data",
]);

export interface SweepRemoved {
  path: string;
  kind: SweepKind;
  why: string;
  bytes: number;
  sessionId?: string;
}

export interface SweepSkipped {
  path: string;
  kind: SweepKind;
  reason: string;
  sessionId?: string;
}

export interface CategoryTotal {
  count: number;
  bytes: number;
}

// What is on disk after the run, for the one-line summary.
export interface SweepTotals {
  worktrees: CategoryTotal;
  databases: CategoryTotal;
  spares: CategoryTotal;
  temp: CategoryTotal;
}

export interface SweepSummary {
  removed: SweepRemoved[];
  skipped: SweepSkipped[];
  freedBytes: number;
  // Found but left, because the full clean-up isn't turned on.
  pending?: SweepRemoved[];
  // The whole of pending, once a stored run keeps only its biggest.
  pendingTotal?: CategoryTotal;
  totals?: SweepTotals;
  armed?: boolean;
  // Where a dry run wrote its list.
  report?: string;
}

export interface SweepRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  dryRun: boolean;
  removed: number;
  freedBytes: number;
  skipped: number;
  details: SweepSummary | null;
  error: string | null;
}

export type DaysSource = "project" | "global" | "default";

export interface ResolvedDays {
  days: number;
  from: DaysSource;
}

// A directory the sweep may remove, once it has been judged.
export interface Candidate {
  path: string;
  kind: SweepKind;
  sessionId?: string;
  // The main checkout git knows it by, when it is a registered worktree.
  repo?: string;
  // The PR head a merge took, when the session has one.
  prNumber?: number | null;
  branch?: string | null;
  // A database: the server it lives on, and why it's reapable.
  server?: { host?: string; port?: number };
  why?: string;
  // Known without measuring (a database's size).
  bytes?: number;
}
