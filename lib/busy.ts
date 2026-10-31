import { db } from "./db";
import { runningStarts } from "./simulator";

// What a restart would cut off and have to start over: reviews, task
// setups, simulator starts, merges and stack landings run in the server. (Chat turns run in their own workers and
// outlive it.) Older than half an hour is stuck, not in flight.
export function inFlight(): {
  reviews: number;
  setups: number;
  simulatorStarts: number;
  merges: number;
  landings: number;
} {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    reviews: count(
      `SELECT COUNT(*) AS n FROM orchestrator_checks
       WHERE status = 'running' AND kind IN ('review', 'scope')
         AND created_at > datetime('now', '-30 minutes')`
    ),
    setups: count(
      `SELECT COUNT(*) AS n FROM sessions
       WHERE setup_status = 'running' AND archived_at IS NULL
         AND created_at > datetime('now', '-30 minutes')`
    ),
    simulatorStarts: runningStarts(),
    merges: mergesInFlight(),
    landings: count(
      `SELECT COUNT(*) AS n FROM stacks WHERE status = 'landing'`
    ),
  };
}

// Between `gh pr merge` and the tidying after it (lib/tasks/finish.ts keeps
// both on globalThis, so every bundle sees the same ones).
function mergesInFlight(): number {
  const g = globalThis as unknown as {
    __agentosSigningOff?: Set<string>;
    __agentosAfterMerge?: Map<string, unknown>;
  };
  return new Set([
    ...(g.__agentosSigningOff ?? []),
    ...(g.__agentosAfterMerge?.keys() ?? []),
  ]).size;
}

export const inFlightTotal = (w: ReturnType<typeof inFlight>): number =>
  w.reviews + w.setups + w.simulatorStarts + w.merges + w.landings;
