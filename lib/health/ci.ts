/**
 * How long CI takes, learned from what the orchestrator already sees. Each
 * diff it reads every open PR's verdict; the first time a head is pending is
 * when its run started (to within a diff), and the first time it isn't is
 * when it settled. No extra gh call.
 */

import { db } from "../db";
import type { SessionFacts } from "../orchestrator/facts";
import { MIN, type CiFact } from "./types";

const BASELINE_RUNS = 20;
// A pending row older than this is a lost one, not a slow run.
const LOST_AFTER_MS = 24 * 60 * MIN;

export function observeCi(
  workspaceId: string,
  facts: Pick<SessionFacts, "project" | "task">[],
  now: number
): void {
  db.transaction(() => {
    for (const f of facts) {
      const pr = f.task?.pr;
      const project = f.project;
      if (!pr || !project) continue;
      const head = pr.head;
      if (pr.state !== "OPEN" || !head) {
        db.prepare(
          `DELETE FROM ci_runs WHERE project_id = ? AND pr_number = ?
           AND settled_at IS NULL`
        ).run(project, pr.number);
        continue;
      }
      if (pr.checks === "pending") {
        // A newer head replaces the run still pending on an older one.
        db.prepare(
          `DELETE FROM ci_runs WHERE project_id = ? AND pr_number = ?
           AND head != ? AND settled_at IS NULL`
        ).run(project, pr.number, head);
        db.prepare(
          `INSERT OR IGNORE INTO ci_runs
             (project_id, workspace_id, pr_number, head, pending_since)
           VALUES (?, ?, ?, ?, ?)`
        ).run(project, workspaceId, pr.number, head, now);
      } else if (pr.checks === "pass" || pr.checks === "fail") {
        db.prepare(
          `UPDATE ci_runs SET settled_at = ?
           WHERE project_id = ? AND pr_number = ? AND head = ?
           AND settled_at IS NULL`
        ).run(now, project, pr.number, head);
      }
    }
  })();
}

export function pendingCi(now: number): CiFact[] {
  const rows = db
    .prepare(
      `SELECT * FROM ci_runs WHERE settled_at IS NULL AND pending_since >= ?`
    )
    .all(now - LOST_AFTER_MS) as {
    project_id: string;
    workspace_id: string | null;
    pr_number: number;
    head: string;
    pending_since: number;
  }[];
  return rows.map((r) => ({
    projectId: r.project_id,
    workspaceId: r.workspace_id,
    prNumber: r.pr_number,
    head: r.head,
    pendingSince: r.pending_since,
    baseline: baseline(r.project_id),
  }));
}

export function baseline(projectId: string): number[] {
  return (
    db
      .prepare(
        `SELECT settled_at - pending_since AS ms FROM ci_runs
         WHERE project_id = ? AND settled_at IS NOT NULL
         ORDER BY settled_at DESC LIMIT ?`
      )
      .all(projectId, BASELINE_RUNS) as { ms: number }[]
  )
    .map((r) => r.ms)
    .filter((ms) => ms > 0);
}
