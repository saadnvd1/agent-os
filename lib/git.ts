/**
 * Git utilities for worktree management
 */

import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
    await execFileAsync("git", ["-C", resolvedPath, "rev-parse", "--git-dir"], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name
 */
export async function getCurrentBranch(dirPath: string): Promise<string> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  const { stdout } = await execFileAsync(
    "git",
    ["-C", resolvedPath, "rev-parse", "--abbrev-ref", "HEAD"],
    { timeout: 5000 }
  );
  return stdout.trim();
}

/**
 * Get the default branch (main or master)
 */
export async function getDefaultBranch(dirPath: string): Promise<string> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  try {
    // Try to get the default branch from remote
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolvedPath, "symbolic-ref", "refs/remotes/origin/HEAD"],
      { timeout: 5000 }
    );
    const name = stdout.trim().replace(/^refs\/remotes\/origin\//, "");
    // The remote picks this name: anything that isn't a plain branch name
    // (a "$(...)" a hostile repo could set) is ignored.
    if (name && isBranchName(name)) {
      return name;
    }
  } catch {
    // Ignore
  }

  // Fallback: check if main or master exists
  try {
    await execFileAsync(
      "git",
      ["-C", resolvedPath, "rev-parse", "--verify", "main"],
      {
        timeout: 5000,
      }
    );
    return "main";
  } catch {
    try {
      await execFileAsync(
        "git",
        ["-C", resolvedPath, "rev-parse", "--verify", "master"],
        {
          timeout: 5000,
        }
      );
      return "master";
    } catch {
      // Return current branch as fallback
      return getCurrentBranch(resolvedPath);
    }
  }
}

/**
 * Get list of local branches
 */
export async function getBranches(dirPath: string): Promise<string[]> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  const { stdout } = await execAsync(
    `git -C "${resolvedPath}" branch --format='%(refname:short)'`,
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
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  try {
    await execAsync(
      `git -C "${resolvedPath}" rev-parse --verify "${branchName}"`,
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the repository name from path
 */
export function getRepoName(dirPath: string): string {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  return path.basename(resolvedPath);
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
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  try {
    const { stdout } = await execAsync(
      `git -C "${resolvedPath}" ls-remote --heads origin "${branchName}"`,
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
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  await execFileAsync(
    "git",
    ["-C", resolvedPath, "branch", "-m", "--", oldBranchName, newBranchName],
    { timeout: 10000 }
  );
}

/**
 * Get git status summary (files changed, ahead/behind)
 */
export async function getGitStatus(dirPath: string): Promise<{
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");

  // Get file counts
  const { stdout: statusOutput } = await execAsync(
    `git -C "${resolvedPath}" status --porcelain`,
    { timeout: 5000 }
  );

  const lines = statusOutput.trim().split("\n").filter(Boolean);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of lines) {
    const index = line[0];
    const worktree = line[1];
    if (index === "?" && worktree === "?") {
      untracked++;
    } else {
      if (index !== " " && index !== "?") staged++;
      if (worktree !== " " && worktree !== "?") unstaged++;
    }
  }

  // Get ahead/behind counts
  let ahead = 0;
  let behind = 0;
  try {
    const { stdout: aheadBehind } = await execAsync(
      `git -C "${resolvedPath}" rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo "0 0"`,
      { timeout: 5000 }
    );
    const [a, b] = aheadBehind.trim().split(/\s+/);
    ahead = parseInt(a, 10) || 0;
    behind = parseInt(b, 10) || 0;
  } catch {
    // No upstream, ignore
  }

  return { staged, unstaged, untracked, ahead, behind };
}
