import { db } from "./db";

// What a restart would cut off and have to start over: reviews and task
// setups run in the server. (Chat turns run in their own workers and
// outlive it.) Older than half an hour is stuck, not in flight.
export function inFlight(): { reviews: number; setups: number } {
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
  };
}
