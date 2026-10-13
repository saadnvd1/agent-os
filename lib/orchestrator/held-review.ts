// A held task is with Saad, so `review` normally has nothing to do. Except
// when the orchestrator has asked him to merge a commit: sign_off needs a
// finished review of exactly that commit before an approval of it merges,
// and a held task would otherwise never get one.

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
  return open?.raised_by === "orchestrator" && open.sha === head;
}
