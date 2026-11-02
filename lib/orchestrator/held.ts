// A task that's with Saad merges only on his approval of its exact head
// commit, once (signoff.ts). A new commit since he approved goes back to him.

import { AskRefused, raiseAsk, workSubject } from "./asks";
import { latestApproval } from "./ask-approvals";
import type { FailureRow } from "./gates";
import type { Verdict } from "./signoff";
import { owner, Owner } from "../owner";

const short = (sha: string) => sha.slice(0, 7);

export function heldVerdict(
  workspaceId: string,
  task: { id: string; name: string },
  held: FailureRow[],
  url: string,
  sha: string,
  pr: number,
  moved?: string
): Verdict {
  // An approval of this head was judged before this (signoff.ts).
  const approval = latestApproval(workspaceId, workSubject(task.id));
  if (approval) {
    const why = `${Owner()} approved ${approval.sha ? short(approval.sha) : "an earlier commit"}, but PR #${pr}'s head is now ${short(sha)}${moved ? ` and ${moved}` : ""}`;
    try {
      raiseAsk({
        workspaceId,
        subject: workSubject(task.id),
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
  const waiting = held.some((h) => h.ask_held_at)
    ? " His ask goes up once its agent is idle and CI has settled on its latest head."
    : "";
  return {
    ok: false,
    wait: false,
    text: `${task.name} is with ${owner()} (${held.map((h) => h.gate).join(", ")}: ${held[0].last_reason}). Only he can merge it now, or approve it on his asks list.${waiting}`,
  };
}
