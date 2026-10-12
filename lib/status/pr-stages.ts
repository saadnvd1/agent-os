// A task's PR stage for the sidebar, from state AgentOS already holds: the
// PR as the last poll saw it, the stored review and CI checks, escalations,
// asks and the armed flag. Nothing here asks GitHub.
import { cachedPR, storedPR } from "../tasks/session";
import { derivePrStage } from "../tasks/pr-stage";
import { getCheck } from "../orchestrator/checks";
import { holdingEscalations } from "../orchestrator/gates";
import { openBySubject, workSubject } from "../orchestrator/asks";
import { ciSettleLeft } from "../orchestrator/task-state";
import { knownCommitTime } from "../orchestrator/facts";
import { prMemo, type Pass } from "./incremental";
import type { SessionStatusResponse } from "./collect";

export function addPrStages(
  statuses: Record<string, SessionStatusResponse>,
  pass: Pass
): void {
  for (const t of pass.rows.values()) {
    if (t.task_status !== "running" || !t.pr_number || !t.project_id) continue;
    const status = statuses[t.id];
    if (!status || t.project_workspace_id === null) continue;
    const workspaceId = t.project_workspace_id;
    const stage = prMemo(pass, t.id, () => {
      try {
        const pr = cachedPR(t.id) ?? storedPR(t);
        const head = pr?.head;
        const settleIn =
          pr?.checks === "pass" && head
            ? ciSettleLeft({
                taskId: t.id,
                sha: head,
                checkCount: pr.checkCount ?? 0,
                committedAt: knownCommitTime(head),
              })
            : 0;
        return {
          value: derivePrStage({
            pr,
            settleIn,
            review: head
              ? (getCheck(t.id, head, "review")?.status ?? null)
              : null,
            held:
              holdingEscalations(t.id).length > 0 ||
              !!openBySubject(workspaceId, workSubject(t.id)),
            armed: !!t.merge_armed_at,
          }),
          // Counting down to the end of the settle wait: time moves it.
          keep: settleIn <= 0,
        };
      } catch (error) {
        console.error(`[status] PR stage of ${t.id.slice(0, 8)}:`, error);
        return { value: null, keep: false };
      }
    });
    if (stage) status.prStage = stage;
  }
}
