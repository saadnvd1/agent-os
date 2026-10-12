/**
 * Repository questions AgentOS asks: is this a repo, which branch is the
 * default, which branches exist. Every git call goes through lib/git-exec.
 */

import * as os from "os";
import * as path from "path";
import { currentBranch, git, gitOk, resolveRef } from "./git-exec";

const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

/**
 * Check if a directory is a git repository. A slow mount gets the git
 * panel's 30s before it reads as "not a repository".
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  return gitOk(expandHome(dirPath), ["rev-parse", "--git-dir"], {
    timeout: 30_000,
  });
}

/**
 * The checked-out branch, "HEAD" when detached.
 */
export async function getCurrentBranch(dirPath: string): Promise<string> {
  return (
    (await currentBranch(expandHome(dirPath), { timeout: 5000 })) || "HEAD"
  );
}

/**
 * The default branch: the remote's, else main, else master, else the
 * current one.
 */
export async function getDefaultBranch(dirPath: string): Promise<string> {
  const dir = expandHome(dirPath);
  const opts = { timeout: 5000 };
  const remote = await git(
    dir,
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    opts
  ).catch(() => "");
  const name = remote.trim().replace(/^refs\/remotes\/origin\//, "");
  // The remote picks this name: anything that isn't a plain branch name
  // (a "$(...)" a hostile repo could set) is ignored.
  if (name && isBranchName(name)) return name;
  if (await resolveRef(dir, "main", opts)) return "main";
  if (await resolveRef(dir, "master", opts)) return "master";
  return getCurrentBranch(dir);
}

/**
 * Get list of local branches
 */
export async function getBranches(dirPath: string): Promise<string[]> {
  const stdout = await git(
    expandHome(dirPath),
    ["branch", "--format=%(refname:short)"],
    { timeout: 5000 }
  );
  return stdout
    .trim()
    .split("\n")
    .filter((b) => b);
}

/**
 * Check if a branch exists
 */
export async function branchExists(
  dirPath: string,
  branchName: string
): Promise<boolean> {
  return gitOk(
    expandHome(dirPath),
    ["rev-parse", "--verify", "--end-of-options", branchName],
    { timeout: 5000 }
  );
}

/**
 * Get the repository name from path
 */
export function getRepoName(dirPath: string): string {
  return path.basename(expandHome(dirPath));
}

/**
 * Slugify a string for use in branch names
 */
// A plain branch name: no leading dash (an option), no "..", "//" or "@{",
// nothing a shell or git would read as anything else.
export const BRANCH_NAME =
  /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,200}(?<![./])$/;

export const isBranchName = (name: string) => BRANCH_NAME.test(name);

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

/**
 * Generate a branch name from a feature description
 */
export function generateBranchName(feature: string): string {
  const slug = slugify(feature);
  return `feature/${slug}`;
}

/**
 * Check if a branch exists on remote
 */
export async function remoteBranchExists(
  dirPath: string,
  branchName: string
): Promise<boolean> {
  try {
    const stdout = await git(
      expandHome(dirPath),
      ["ls-remote", "--heads", "origin", "--", branchName],
      { timeout: 10000 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Rename a local branch that was never pushed. A pushed branch keeps its
 * name: renaming it on the remote means deleting the old one, which closes
 * its PR. Throws when it can't rename.
 */
export async function renameBranch(
  dirPath: string,
  oldBranchName: string,
  newBranchName: string
): Promise<void> {
  if (await remoteBranchExists(dirPath, oldBranchName))
    throw new Error(`${oldBranchName} is on the remote; keeping its name`);
  await git(
    expandHome(dirPath),
    ["branch", "-m", "--", oldBranchName, newBranchName],
    { timeout: 10000 }
  );
}

export interface GitCheck {
  isGitRepo: boolean;
  branches: string[];
  defaultBranch: string | null;
  currentBranch: string | null;
}

/** Whether a path is a repository, and its branches. */
export async function gitCheck(dirPath: string): Promise<GitCheck> {
  if (!(await isGitRepo(dirPath)))
    return {
      isGitRepo: false,
      branches: [],
      defaultBranch: null,
      currentBranch: null,
    };
  const [branches, defaultBranch, currentBranch] = await Promise.all([
    getBranches(dirPath),
    getDefaultBranch(dirPath),
    getCurrentBranch(dirPath),
  ]);
  return { isGitRepo: true, branches, defaultBranch, currentBranch };
}
