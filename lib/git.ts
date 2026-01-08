/**
 * Git utilities for worktree management
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
    await execAsync(`git -C "${resolvedPath}" rev-parse --git-dir`, {
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
  const { stdout } = await execAsync(
    `git -C "${resolvedPath}" rev-parse --abbrev-ref HEAD`,
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
    const { stdout } = await execAsync(
      `git -C "${resolvedPath}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'`,
      { timeout: 5000 }
    );
    if (stdout.trim()) {
      return stdout.trim();
    }
  } catch {
    // Ignore
  }

  // Fallback: check if main or master exists
  try {
    await execAsync(`git -C "${resolvedPath}" rev-parse --verify main`, {
      timeout: 5000,
    });
    return "main";
  } catch {
    try {
      await execAsync(`git -C "${resolvedPath}" rev-parse --verify master`, {
        timeout: 5000,
      });
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
