/**
 * What was checked on one exact commit of a task: the independent review
 * and the scope check against its card. Stored per (task, sha), so a new
 * commit needs a new review and an old verdict never covers it.
 */

import { db } from "../db";

export type CheckKind = "review" | "scope";
// running: under way. pass / block: done. error: the check itself failed.
export type CheckStatus = "running" | "pass" | "block" | "error";

export interface CheckRow {
  id: number;
  workspace_id: string;
  session_id: string;
  sha: string;
  kind: CheckKind;
  status: CheckStatus;
  detail: string | null;
  created_at: string;
}

export function getCheck(
  sessionId: string,
  sha: string,
  kind: CheckKind
): CheckRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM orchestrator_checks WHERE session_id = ? AND sha = ? AND kind = ?`
      )
      .get(sessionId, sha, kind) as CheckRow | undefined) ?? null
  );
}

export function putCheck(row: {
  workspaceId: string;
  sessionId: string;
  sha: string;
  kind: CheckKind;
  status: CheckStatus;
  detail?: string | null;
}): CheckRow {
  db.prepare(
    `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status, detail)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, sha, kind) DO UPDATE SET
       status = excluded.status, detail = excluded.detail, created_at = datetime('now')`
  ).run(
    row.workspaceId,
    row.sessionId,
    row.sha,
    row.kind,
    row.status,
    row.detail ?? null
  );
  return getCheck(row.sessionId, row.sha, row.kind)!;
}

// A review left "running" by a server that went down is not running.
export function clearStaleRunning(maxAgeMinutes = 30): void {
  db.prepare(
    `UPDATE orchestrator_checks SET status = 'error', detail = 'Interrupted: run it again'
     WHERE status = 'running' AND created_at < datetime('now', ?)`
  ).run(`-${maxAgeMinutes} minutes`);
}
