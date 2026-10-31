// The finished updates, newest first, and what they say about trying a
// version again. Pure apart from the two setting accessors passed in.

import type { UpdateAttempt, UpdateRun } from "./banner";

export const HISTORY_KEY = "updates.attempts";
const KEEP = 20;
/** A version that failed to build is tried again after these waits, then given up on. */
export const RETRY_AFTER_MS = [60 * 60_000, 6 * 60 * 60_000] as const;

type Get = (key: string) => string | null;
type Put = (key: string, value: string | null) => void;

export function readAttempts(get: Get): UpdateAttempt[] {
  try {
    const list = JSON.parse(get(HISTORY_KEY) ?? "[]") as UpdateAttempt[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** The attempt a finished run makes, or null while it runs or when it isn't one. */
export function attemptOf(run: UpdateRun | null): UpdateAttempt | null {
  if (!run?.outcome || !run.finishedAt || !run.to) return null;
  return {
    id: run.id,
    from: run.from,
    to: run.to,
    fromVersion: run.fromVersion,
    toVersion: run.toVersion,
    auto: !!run.auto,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    outcome: run.outcome,
    ...(run.error ? { error: run.error } : {}),
  };
}

/** Adds an attempt once (by id), newest first; true when it was new. */
export function recordAttempt(
  get: Get,
  put: Put,
  attempt: UpdateAttempt
): boolean {
  const list = readAttempts(get);
  if (list.some((a) => a.id === attempt.id)) return false;
  put(HISTORY_KEY, JSON.stringify([attempt, ...list].slice(0, KEEP)));
  return true;
}

export type Block =
  | { kind: "bad"; reason: string }
  | { kind: "later"; until: number; reason: string };

/**
 * Why a commit shouldn't be tried now: it was rolled back or broke the
 * server (never again), failed to build too often (never again), or failed
 * recently (after a wait). Interrupted runs say nothing about the commit.
 */
export function blockFor(
  sha: string,
  attempts: UpdateAttempt[],
  now: number
): Block | null {
  const mine = attempts.filter((a) => a.to === sha);
  if (mine.some((a) => a.outcome === "rolled_back" || a.outcome === "broken"))
    return {
      kind: "bad",
      reason: "it didn't start cleanly last time, so it won't be tried again",
    };
  // Only failures since it last worked count: a version can be updated to,
  // rolled back by hand, and updated to again.
  const fails: UpdateAttempt[] = [];
  for (const a of mine) {
    if (a.outcome === "done") break;
    if (a.outcome === "build_failed") fails.push(a);
  }
  if (!fails.length) return null;
  if (fails.length > RETRY_AFTER_MS.length)
    return {
      kind: "bad",
      reason: `it failed to build ${fails.length} times, so it won't be tried again`,
    };
  const until = fails[0].finishedAt + RETRY_AFTER_MS[fails.length - 1];
  return until > now
    ? { kind: "later", until, reason: "it failed to build last time" }
    : null;
}

/** Failed automatic attempts since the last update that worked (by anyone). */
export function failedInARow(attempts: UpdateAttempt[]): number {
  let n = 0;
  for (const a of attempts) {
    if (a.outcome === "done") break;
    if (a.auto && a.outcome !== "interrupted") n++;
  }
  return n;
}
