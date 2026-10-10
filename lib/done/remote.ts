// A task merged on GitHub can leave its branch on origin. Done deletes it
// only when origin's branch is exactly the commit that merged, and never
// while stacked cards still build on it (their PRs target it).

import type { Session } from "../db";
import type { TaskPR } from "../tasks";
import { run } from "../tasks/gh";
import { projectPathFor } from "../tasks/session";
import { PROTECTED_BRANCHES } from "../tasks/finish";
import { liveChildren } from "../stacks/guard";

export async function deleteMergedRemote(
  s: Session,
  pr: TaskPR | null
): Promise<boolean> {
  const repo = projectPathFor(s);
  const branch = s.branch_name;
  if (
    !repo ||
    !branch ||
    PROTECTED_BRANCHES.has(branch) ||
    !pr?.head ||
    liveChildren(s.id).length
  )
    return false;
  const line = await run(
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    repo,
    30000
  ).catch(() => "");
  const tip = line.trim().split(/\s+/)[0];
  if (!tip || tip !== pr.head) return false;
  return run("git", ["push", "origin", "--delete", branch], repo, 60000)
    .then(() => true)
    .catch(() => false);
}
