import { db } from "../db";
import type { SweepRun, SweepSummary } from "./types";

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  dry_run: number;
  removed: number;
  freed_bytes: number;
  skipped: number;
  details: string | null;
  error: string | null;
}

// The counts are exact; the lists kept for a run stop here (a first run can
// skip thousands of folders that are simply too young).
const DETAIL_CAP = 300;

const view = (r: RunRow): SweepRun => ({
  id: r.id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  dryRun: !!r.dry_run,
  removed: r.removed,
  freedBytes: r.freed_bytes,
  skipped: r.skipped,
  details: r.details ? (JSON.parse(r.details) as SweepSummary) : null,
  error: r.error,
});

export function startRun(dryRun: boolean): number {
  return Number(
    db
      .prepare(`INSERT INTO worktree_sweep_runs (dry_run) VALUES (?)`)
      .run(dryRun ? 1 : 0).lastInsertRowid
  );
}

export function finishRun(
  id: number,
  summary: SweepSummary,
  error: string | null
): void {
  db.prepare(
    `UPDATE worktree_sweep_runs SET finished_at = datetime('now'), removed = ?,
       freed_bytes = ?, skipped = ?, details = ?, error = ? WHERE id = ?`
  ).run(
    summary.removed.length,
    summary.freedBytes,
    summary.skipped.length,
    JSON.stringify({
      ...summary,
      skipped: summary.skipped.slice(0, DETAIL_CAP),
    }),
    error,
    id
  );
}

export function recentRuns(limit = 30): SweepRun[] {
  return (
    db
      .prepare(`SELECT * FROM worktree_sweep_runs ORDER BY id DESC LIMIT ?`)
      .all(limit) as RunRow[]
  ).map(view);
}

export function recordSwept(
  sessionId: string,
  path: string,
  branch: string | null,
  runId: number
): void {
  db.prepare(
    `INSERT INTO session_worktree_sweeps (session_id, path, branch, run_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET path = excluded.path,
       branch = excluded.branch, swept_at = datetime('now'), run_id = excluded.run_id`
  ).run(sessionId, path, branch, runId);
}

export function sweptAt(sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT swept_at FROM session_worktree_sweeps WHERE session_id = ?`
    )
    .get(sessionId) as { swept_at: string } | undefined;
  return row?.swept_at ?? null;
}

export function forgetSwept(sessionId: string): void {
  db.prepare(`DELETE FROM session_worktree_sweeps WHERE session_id = ?`).run(
    sessionId
  );
}
