// A held task is with Saad, so `review` normally has nothing to do. Except
// for the commit his merge ask names: an approval of an ask the
// orchestrator raised needs a finished review of exactly that commit
// (sign_off), and any other merge ask shows him that review before he
// answers (ask-verdict.ts). A held task would otherwise never get one.

import { latestApproval } from "./ask-approvals";
import { openBySubject, workSubject } from "./asks";

export function reviewWanted(
  workspaceId: string,
  id: string,
  head: string
): boolean {
  const subject = workSubject(id);
  if (latestApproval(workspaceId, subject)?.sha === head) return true;
  const open = openBySubject(workspaceId, subject);
  return (
    (open?.raised_by === "orchestrator" || open?.kind === "gate") &&
    open.sha === head
  );
}
