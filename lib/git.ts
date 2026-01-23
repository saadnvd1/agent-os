/**
 * Git utilities for worktree management
 */

import * as path from "path";
import * as fs from "fs";
import { execForProject } from "./exec-wrapper";

/**
 * Check if a directory is a git repository
 */
export async function isGitRepo(
  projectId: string,
  dirPath: string
): Promise<boolean> {
  try {
    const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
    await execForProject(projectId, "git rev-parse --git-dir", {
      cwd: resolvedPath,
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
export async function getCurrentBranch(
  projectId: string,
  dirPath: string
): Promise<string> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  const { stdout } = await execForProject(
    projectId,
    "git rev-parse --abbrev-ref HEAD",
    {
      cwd: resolvedPath,
      timeout: 5000,
    }
  );
  return stdout.trim();
}

/**
 * Get the default branch (main or master)
 */
export async function getDefaultBranch(
  projectId: string,
  dirPath: string
): Promise<string> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  try {
    // Try to get the default branch from remote
    const { stdout } = await execForProject(
      projectId,
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'",
      {
        cwd: resolvedPath,
        timeout: 5000,
      }
    );
    if (stdout.trim()) {
      return stdout.trim();
    }
  } catch {
    // Ignore
  }

  // Fallback: check if main or master exists
  try {
    await execForProject(projectId, "git rev-parse --verify main", {
      cwd: resolvedPath,
      timeout: 5000,
    });
    return "main";
  } catch {
    try {
      await execForProject(projectId, "git rev-parse --verify master", {
        cwd: resolvedPath,
        timeout: 5000,
      });
      return "master";
    } catch {
      // Return current branch as fallback
      return getCurrentBranch(projectId, resolvedPath);
    }
  }
}

/**
 * Get list of local branches
 */
export async function getBranches(
  projectId: string,
  dirPath: string
): Promise<string[]> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  const { stdout } = await execForProject(
    projectId,
    "git branch --format='%(refname:short)'",
    {
      cwd: resolvedPath,
      timeout: 5000,
    }
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
  projectId: string,
  dirPath: string,
  branchName: string
): Promise<boolean> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  try {
    await execForProject(projectId, `git rev-parse --verify "${branchName}"`, {
      cwd: resolvedPath,
      timeout: 5000,
    });
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
 * Check if a branch exists on remote
 */
export async function remoteBranchExists(
  projectId: string,
  dirPath: string,
  branchName: string
): Promise<boolean> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  try {
    const { stdout } = await execForProject(
      projectId,
      `git ls-remote --heads origin "${branchName}"`,
      {
        cwd: resolvedPath,
        timeout: 10000,
      }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Rename a branch locally and optionally on remote
 * Returns the new branch name or throws on error
 */
export async function renameBranch(
  projectId: string,
  dirPath: string,
  oldBranchName: string,
  newBranchName: string
): Promise<{ renamed: boolean; remoteRenamed: boolean }> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");
  let renamed = false;
  let remoteRenamed = false;

  // Rename local branch
  try {
    await execForProject(
      projectId,
      `git branch -m "${oldBranchName}" "${newBranchName}"`,
      {
        cwd: resolvedPath,
        timeout: 10000,
      }
    );
    renamed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to rename local branch: ${message}`);
  }

  // Check if old branch exists on remote and rename there too
  const hasRemote = await remoteBranchExists(projectId, dirPath, oldBranchName);
  if (hasRemote) {
    try {
      // Push new branch to remote
      await execForProject(
        projectId,
        `git push origin "${newBranchName}" -u`,
        {
          cwd: resolvedPath,
          timeout: 30000,
        }
      );
      // Delete old branch from remote
      await execForProject(
        projectId,
        `git push origin --delete "${oldBranchName}"`,
        {
          cwd: resolvedPath,
          timeout: 30000,
        }
      );
      remoteRenamed = true;
    } catch {
      // Remote rename failed but local succeeded - that's okay
      console.error(
        `Warning: Local branch renamed but remote rename failed for ${oldBranchName}`
      );
    }
  }

  return { renamed, remoteRenamed };
}

/**
 * Get git status summary (files changed, ahead/behind)
 */
export async function getGitStatus(
  projectId: string,
  dirPath: string
): Promise<{
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
}> {
  const resolvedPath = dirPath.replace(/^~/, process.env.HOME || "");

  // Get file counts
  const { stdout: statusOutput } = await execForProject(
    projectId,
    "git status --porcelain",
    {
      cwd: resolvedPath,
      timeout: 5000,
    }
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
    const { stdout: aheadBehind } = await execForProject(
      projectId,
      "git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo '0 0'",
      {
        cwd: resolvedPath,
        timeout: 5000,
      }
    );
    const [a, b] = aheadBehind.trim().split(/\s+/);
    ahead = parseInt(a, 10) || 0;
    behind = parseInt(b, 10) || 0;
  } catch {
    // No upstream, ignore
  }

  return { staged, unstaged, untracked, ahead, behind };
}
