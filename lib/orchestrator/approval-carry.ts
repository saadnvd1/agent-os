// Saad's merge approval across a rebase. He approved a commit; the task
// rebased onto the base (only to renumber a migration, say) and its head
// moved. The approval was for the PR's patch, so it follows the head when
// that patch is unchanged (the check the review's carry-over uses, patch.ts),
// and otherwise is asked again, with a note on what changed.

import type { AskRow } from "./asks";
import { getAsk } from "./asks";
import { rebindApproval } from "./ask-approvals";
import { addNote } from "./notes";
import { comparePatches } from "./patch";
import { fetchRefs } from "./repo";
import type { Session } from "../db";
import { Owner } from "../owner";

const short = (sha: string) => sha.slice(0, 7);

export async function carryApproval(
  workspaceId: string,
  work: {
    name: string;
    repo: string;
    refs: Pick<Session, "base_branch" | "branch_name">;
  },
  approval: AskRow & { sha: string },
  head: string
): Promise<{ approval: AskRow | null; note: string }> {
  let base: string;
  try {
    base = await fetchRefs(work.repo, work.refs);
  } catch {
    return { approval: null, note: "its base couldn't be fetched to compare" };
  }
  const { same, note } = await comparePatches(
    work.repo,
    base,
    approval.sha,
    head
  );
  if (!same) return { approval: null, note };
  const line = `Carried to ${short(head)}: same patch as ${short(approval.sha)} (rebased onto ${base}).`;
  if (rebindApproval(approval.id, approval.sha, head, line))
    addNote(
      workspaceId,
      `${Owner()}'s approval of ${work.name} at ${short(approval.sha)} carries to ${short(head)}: same patch, rebased onto ${base}.`
    );
  const now = getAsk(workspaceId, approval.id);
  return { approval: now?.sha === head && !now.used_at ? now : null, note };
}
