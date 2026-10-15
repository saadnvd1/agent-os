export type SweepKind = "settled" | "orphan" | "test-leak";

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

export interface SweepSummary {
  removed: SweepRemoved[];
  skipped: SweepSkipped[];
  freedBytes: number;
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
}
