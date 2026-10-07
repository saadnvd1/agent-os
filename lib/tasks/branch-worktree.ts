/**
 * A worktree for a branch that already exists on origin, for a task arriving
 * from another machine. A task moving back finds its old worktree still on
 * the branch and brings it to the branch rather than making a second one.
 */

import fs from "fs";
import path from "path";
import { getRepoName, slugify } from "../git";
import { WORKTREES_DIR } from "../worktrees";
import { run } from "./gh";
import { pushedRef } from "./move";

const git = (cwd: string, ...args: string[]) => run("git", args, cwd, 120000);

/** The worktree that has this branch checked out, if one does. */
export function worktreeOnBranch(
  porcelain: string,
  branch: string
): string | null {
  let current: string | null = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice(9);
    else if (line === `branch refs/heads/${branch}` && current) return current;
  }
  return null;
}

export function worktreeDirFor(
  projectPath: string,
  branch: string,
  exists: (p: string) => boolean = fs.existsSync
): string {
  const base = `${getRepoName(projectPath)}-${slugify(branch.replace(/^feature\//, ""))}`;
  let dir = path.join(WORKTREES_DIR, base);
  for (let n = 2; exists(dir); n++)
    dir = path.join(WORKTREES_DIR, `${base}-${n}`);
  return dir;
}

export async function checkoutBranchWorktree(
  projectPath: string,
  branch: string
): Promise<{ worktreePath: string; reused: boolean }> {
  await git(
    projectPath,
    "fetch",
    "-q",
    "origin",
    `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  );
  const existing = worktreeOnBranch(
    await git(projectPath, "worktree", "list", "--porcelain"),
    branch
  );
  if (existing && fs.existsSync(existing)) {
    if ((await git(existing, "status", "--porcelain")).trim())
      throw new Error(
        `${existing} has uncommitted changes; commit or discard them first`
      );
    // Everything it has went out when the task left (pushedRef); the agent
    // elsewhere may have reworded those commits since, so match the branch.
    // Anything never pushed stops it instead, and the old tip stays under
    // its own ref either way.
    const head = (await git(existing, "rev-parse", "HEAD")).trim();
    const sent = await git(
      existing,
      "merge-base",
      "--is-ancestor",
      head,
      pushedRef(branch)
    ).then(
      () => true,
      () => false
    );
    if (!sent)
      throw new Error(
        `${existing} has commits that never left this machine; push or drop them first`
      );
    await git(
      projectPath,
      "update-ref",
      `refs/agentos/before-move/${head}`,
      head
    );
    await git(existing, "reset", "-q", "--hard", `origin/${branch}`);
    return { worktreePath: existing, reused: true };
  }
  if (existing) await git(projectPath, "worktree", "prune");
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  const worktreePath = worktreeDirFor(projectPath, branch);
  await git(
    projectPath,
    "worktree",
    "add",
    "-B",
    branch,
    worktreePath,
    `origin/${branch}`
  );
  await git(worktreePath, "branch", "--set-upstream-to", `origin/${branch}`);
  return { worktreePath, reused: false };
}
