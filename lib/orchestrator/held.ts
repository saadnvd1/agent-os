// A task that's with Saad merges only on his approval of its exact head
// commit, once. A new commit since he approved goes back to him.

import type { Session } from "../db";
import { AskRefused, raiseAsk, taskSubject } from "./asks";
import { latestApproval } from "./ask-approvals";
import type { FailureRow } from "./gates";
import type { Verdict } from "./signoff";

const short = (sha: string) => sha.slice(0, 7);

export function heldVerdict(
  workspaceId: string,
  task: Session,
  held: FailureRow[],
  url: string,
  sha: string,
  pr: number
): Verdict {
  const approval = latestApproval(workspaceId, taskSubject(task.id));
  if (approval?.sha === sha)
    return { ok: true, sha, pr, approval: approval.id };
  if (approval) {
    const why = `Saad approved ${approval.sha ? short(approval.sha) : "an earlier commit"}, but PR #${pr}'s head is now ${short(sha)}`;
    try {
      raiseAsk({
        workspaceId,
        subject: taskSubject(task.id),
        kind: "gate",
        title: `Merge ${task.name}?`,
        detail: why,
        link: url,
        sha,
      });
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
    }
    return {
      ok: false,
      wait: false,
      text: `${task.name}: ${why}. Asked him again; don't retry.`,
    };
  }
  return {
    ok: false,
    wait: false,
    text: `${task.name} is with Saad (${held.map((h) => h.gate).join(", ")}: ${held[0].last_reason}). Only he can merge it now, or approve it on his asks list.`,
  };
}
