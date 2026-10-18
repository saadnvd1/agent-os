/**
 * The fast lane: a project whose tier is "fast" (project-tier) has no CI
 * wait, independent review or scope check on a task's PR. Its gates are
 * trimmed in gates.ts and signoff.ts; this arms each fast task once when its
 * PR opens, so armed.ts merges it on the same pass, and watches the CI of
 * what it merged for a while, telling the orchestrator once if that fails.
 */

import { db, type Session } from "../db";
import { run } from "../tasks/gh";
import { checksVerdict, failingCheck, type RollupEntry } from "../tasks/state";
import { armTask } from "./armed";
import { queueEventOnce } from "./events";
import type { SessionFacts } from "./facts";
import { isPaused } from "./pause";
import { repoOf } from "./repo";
import { isFast } from "../project-tier/getProjectTier";
import {
  fastLaneRow,
  markCiChecked,
  noteAutoArmed,
  watchedMerges,
} from "./fast-lane-state";

const CI_WATCH_HOURS = 3;
const CI_RECHECK_MS = 2 * 60 * 1000;

export async function autoArmFast(
  workspaceId: string,
  facts: SessionFacts[]
): Promise<void> {
  if (isPaused(workspaceId)) return;
  for (const f of facts) {
    const pr = f.task?.pr;
    if (!pr || pr.state !== "OPEN") continue;
    const task = db
      .prepare(
        `SELECT * FROM session_rows WHERE id = ? AND task_status = 'running'
           AND merge_armed_at IS NULL`
      )
      .get(f.id) as Session | undefined;
    if (!task || !isFast(task)) continue;
    if (fastLaneRow(task.id)?.auto_armed_pr === pr.number) continue;
    try {
      armTask(task);
      noteAutoArmed(task.id, workspaceId, pr.number);
    } catch {
      // With Saad, or no orchestrator to tell: retried next pass.
    }
  }
}

async function ghRollup(task: Session, pr: number): Promise<RollupEntry[]> {
  const out = await run(
    "gh",
    ["pr", "view", String(pr), "--json", "statusCheckRollup"],
    repoOf(task),
    15000
  );
  return (JSON.parse(out).statusCheckRollup ?? []) as RollupEntry[];
}

export async function followFastMerges(
  workspaceId: string,
  rollupOf: typeof ghRollup = ghRollup
): Promise<void> {
  const now = Date.now();
  for (const row of watchedMerges(workspaceId, CI_WATCH_HOURS)) {
    const checked = row.ci_checked_at
      ? Date.parse(row.ci_checked_at.replace(" ", "T") + "Z")
      : 0;
    if (now - checked < CI_RECHECK_MS) continue;
    const task = db
      .prepare(`SELECT * FROM session_rows WHERE id = ?`)
      .get(row.session_id) as Session | undefined;
    if (!task || !row.merged_pr) {
      markCiChecked(row.session_id, true);
      continue;
    }
    try {
      const rollup = await rollupOf(task, row.merged_pr);
      const verdict = checksVerdict(rollup);
      if (verdict === "fail") {
        queueEventOnce(
          workspaceId,
          `fast-ci:${row.session_id}:${row.merged_sha}`,
          row.session_id,
          `task ${task.name}: merged on the fast lane (PR #${row.merged_pr}), but CI failed after the merge${failingCheck(rollup) ? ` (${failingCheck(rollup)})` : ""}. Fix forward with a task.`
        );
      }
      markCiChecked(row.session_id, verdict !== "pending");
    } catch {
      markCiChecked(row.session_id, false);
    }
  }
}
