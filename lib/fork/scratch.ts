/**
 * A fork child's own folders under the data root: a scratch folder for temp
 * work (scripts, repros, notes), and, when it was asked for, a throwaway
 * checkout. Both are removed when the child settles or is dropped, and a
 * sweep removes what a crash left.
 */

import fs from "fs";
import path from "path";
import { agentosHome } from "../agentos-home";
import { git } from "../git-exec";

export const forksRoot = () => agentosHome("forks");
export const forkHome = (childId: string) => agentosHome("forks", childId);
export const scratchOf = (childId: string) =>
  path.join(forkHome(childId), "scratch");
export const worktreeOf = (childId: string) =>
  path.join(forkHome(childId), "wt");

// Made on demand, so a settled child that is talked to again has one.
export async function ensureScratch(childId: string): Promise<string> {
  const dir = scratchOf(childId);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

// The folder's real repository, for taking a worktree out of its list.
async function repoOf(wt: string): Promise<string | null> {
  try {
    const common = (
      await git(wt, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    ).trim();
    return path.dirname(common);
  } catch {
    return null;
  }
}

// Everything of the child's, the worktree first so git forgets it.
export async function removeFork(childId: string): Promise<void> {
  const home = forkHome(childId);
  const wt = worktreeOf(childId);
  if (fs.existsSync(wt)) {
    const repo = await repoOf(wt);
    if (repo)
      await git(repo, ["worktree", "remove", "--force", "--", wt]).catch(
        () => undefined
      );
  }
  await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 3 });
}

// Folders of children that are settled or gone: what a crash between a
// settle and its cleanup left. `keep` says whose folders are still in use.
export async function sweepForks(
  keep: (childId: string) => boolean
): Promise<number> {
  const root = forksRoot();
  const names = await fs.promises.readdir(root).catch(() => [] as string[]);
  let removed = 0;
  for (const name of names) {
    if (keep(name)) continue;
    await removeFork(name);
    removed++;
  }
  return removed;
}
