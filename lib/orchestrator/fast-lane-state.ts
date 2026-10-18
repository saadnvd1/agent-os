import { db } from "../db";

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export interface FastLaneRow {
  session_id: string;
  workspace_id: string;
  auto_armed_pr: number | null;
  merged_sha: string | null;
  merged_pr: number | null;
  merged_at: string | null;
  ci_checked_at: string | null;
  ci_done_at: string | null;
}

export function fastLaneRow(sessionId: string): FastLaneRow | undefined {
  return db
    .prepare(`SELECT * FROM fast_lane_tasks WHERE session_id = ?`)
    .get(sessionId) as FastLaneRow | undefined;
}

export function noteAutoArmed(
  sessionId: string,
  workspaceId: string,
  pr: number
): void {
  db.prepare(
    `INSERT INTO fast_lane_tasks (session_id, workspace_id, auto_armed_pr)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET auto_armed_pr = excluded.auto_armed_pr`
  ).run(sessionId, workspaceId, pr);
}

// A fast merge: the PR whose CI is watched for a while afterwards.
export function recordFastMerge(
  sessionId: string,
  workspaceId: string,
  pr: number,
  sha: string
): void {
  db.prepare(
    `INSERT INTO fast_lane_tasks (session_id, workspace_id, merged_sha, merged_pr, merged_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       merged_sha = excluded.merged_sha, merged_pr = excluded.merged_pr,
       merged_at = excluded.merged_at, ci_checked_at = NULL, ci_done_at = NULL`
  ).run(sessionId, workspaceId, sha, pr, now());
}

export function markCiChecked(sessionId: string, done: boolean): void {
  db.prepare(
    `UPDATE fast_lane_tasks SET ci_checked_at = ?, ci_done_at = CASE WHEN ? THEN ? ELSE ci_done_at END
     WHERE session_id = ?`
  ).run(now(), done ? 1 : 0, now(), sessionId);
}

// Merges still inside their CI watch.
export function watchedMerges(
  workspaceId: string,
  sinceHours: number
): FastLaneRow[] {
  return db
    .prepare(
      `SELECT * FROM fast_lane_tasks
       WHERE workspace_id = ? AND merged_at IS NOT NULL AND ci_done_at IS NULL
         AND merged_at > datetime('now', ?)`
    )
    .all(workspaceId, `-${sinceHours} hours`) as FastLaneRow[];
}
