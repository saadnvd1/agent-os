// A task's PR stage for the sidebar, from state AgentOS already holds: the
// PR as the last poll saw it, the stored review and CI checks, escalations,
// asks and the armed flag. Nothing here asks GitHub.
import { db, type Session } from "../db";
import { cachedPR, storedPR } from "../tasks/session";
import { derivePrStage } from "../tasks/pr-stage";
import { getCheck } from "../orchestrator/checks";
import { holdingEscalations } from "../orchestrator/gates";
import { openBySubject, workSubject } from "../orchestrator/asks";
import { ciSettleLeft } from "../orchestrator/task-state";
import { knownCommitTime } from "../orchestrator/facts";
import type { SessionStatusResponse } from "./collect";

type TaskRow = Session & { workspace_id: string };

export function addPrStages(
  statuses: Record<string, SessionStatusResponse>
): void {
  const tasks = db
    .prepare(
      `SELECT s.*, p.workspace_id FROM sessions s
         JOIN projects p ON p.id = s.project_id
        WHERE s.task_status = 'running' AND s.pr_number IS NOT NULL
          AND s.archived_at IS NULL`
    )
    .all() as TaskRow[];
  for (const t of tasks) {
    const status = statuses[t.id];
    if (!status) continue;
    try {
      const pr = cachedPR(t.id) ?? storedPR(t);
      const head = pr?.head;
      const stage = derivePrStage({
        pr,
        settleIn:
          pr?.checks === "pass" && head
            ? ciSettleLeft({
                taskId: t.id,
                sha: head,
                checkCount: pr.checkCount ?? 0,
                committedAt: knownCommitTime(head),
              })
            : 0,
        review: head ? (getCheck(t.id, head, "review")?.status ?? null) : null,
        held:
          holdingEscalations(t.id).length > 0 ||
          !!openBySubject(t.workspace_id, workSubject(t.id)),
        armed: !!t.merge_armed_at,
      });
      if (stage) status.prStage = stage;
    } catch (error) {
      console.error(`[status] PR stage of ${t.id.slice(0, 8)}:`, error);
    }
  }
}
