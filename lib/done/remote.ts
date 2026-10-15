// A task merged on GitHub can leave its branch on origin. Done deletes it
// only when origin's branch is exactly the commit that merged, and never
// while stacked cards still build on it (their PRs target it).

import type { Session } from "../db";
import type { TaskPR } from "../tasks";
import { projectPathFor } from "../tasks/session";
import { deleteTaskBranch } from "../tasks/remote-branch";
import { liveChildren } from "../stacks/guard";

export async function deleteMergedRemote(
  s: Session,
  pr: TaskPR | null
): Promise<boolean> {
  const repo = projectPathFor(s);
  if (!repo || !s.branch_name) return false;
  const out = await deleteTaskBranch({
    repo,
    branch: s.branch_name,
    prHead: pr?.head,
    keep: [s.base_branch],
    hasChildren: liveChildren(s.id).length > 0,
  });
  return out.deleted;
}
