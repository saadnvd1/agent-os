/**
 * Git Worktree management for isolated feature development
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  isGitRepo,
  branchExists,
  getRepoName,
  slugify,
  generateBranchName,
} from "./git";

const execAsync = promisify(exec);

// Base directory for all worktrees
const WORKTREES_DIR = path.join(os.homedir(), ".agent-os", "worktrees");

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  projectPath: string;
  projectName: string;
}

export interface CreateWorktreeOptions {
  projectPath: string;
  featureName: string;
  baseBranch?: string;
}

/**
 * Ensure the worktrees directory exists
 */
async function ensureWorktreesDir(): Promise<void> {
  await fs.promises.mkdir(WORKTREES_DIR, { recursive: true });
}

/**
 * Resolve a path, expanding ~ to home directory
 */
function resolvePath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

/**
 * Generate a unique worktree directory name
 */
function generateWorktreeDirName(projectName: string, featureName: string): string {
  const featureSlug = slugify(featureName);
  return `${projectName}-${featureSlug}`;
}

/**
 * Create a new worktree for a feature branch
 */
export async function createWorktree(
  options: CreateWorktreeOptions
): Promise<WorktreeInfo> {
  const { projectPath, featureName, baseBranch = "main" } = options;

  const resolvedProjectPath = resolvePath(projectPath);

  // Validate project is a git repo
  if (!(await isGitRepo(resolvedProjectPath))) {
    throw new Error(`Not a git repository: ${projectPath}`);
  }

  // Generate branch name
  const branchName = generateBranchName(featureName);

  // Check if branch already exists
  if (await branchExists(resolvedProjectPath, branchName)) {
    throw new Error(`Branch already exists: ${branchName}`);
  }

  // Generate worktree path
  const projectName = getRepoName(resolvedProjectPath);
  const worktreeDirName = generateWorktreeDirName(projectName, featureName);
  const worktreePath = path.join(WORKTREES_DIR, worktreeDirName);

  // Check if worktree path already exists
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  // Ensure worktrees directory exists
  await ensureWorktreesDir();

  // Create the worktree with a new branch
  try {
    await execAsync(
      `git -C "${resolvedProjectPath}" worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
      { timeout: 30000 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create worktree: ${message}`);
  }

  return {
    worktreePath,
    branchName,
    baseBranch,
    projectPath: resolvedProjectPath,
    projectName,
  };
}

/**
 * Delete a worktree and optionally its branch
 */
export async function deleteWorktree(
  worktreePath: string,
  projectPath: string,
  deleteBranch = false
): Promise<void> {
  const resolvedProjectPath = resolvePath(projectPath);
  const resolvedWorktreePath = resolvePath(worktreePath);

  // Get the branch name before removing (for optional deletion)
  let branchName: string | null = null;
  if (deleteBranch) {
    try {
      const { stdout } = await execAsync(
        `git -C "${resolvedWorktreePath}" rev-parse --abbrev-ref HEAD`,
        { timeout: 5000 }
      );
      branchName = stdout.trim();
    } catch {
      // Ignore - worktree might already be gone
    }
  }

  // Remove the worktree
  try {
    await execAsync(
      `git -C "${resolvedProjectPath}" worktree remove "${resolvedWorktreePath}" --force`,
      { timeout: 30000 }
    );
  } catch {
    // If git worktree remove fails, try manual cleanup
    if (fs.existsSync(resolvedWorktreePath)) {
      await fs.promises.rm(resolvedWorktreePath, { recursive: true, force: true });
    }
    // Prune worktree references
    try {
      await execAsync(`git -C "${resolvedProjectPath}" worktree prune`, {
        timeout: 10000,
      });
    } catch {
      // Ignore prune errors
    }
  }

  // Optionally delete the branch
  if (deleteBranch && branchName && branchName !== "main" && branchName !== "master") {
    try {
      await execAsync(
        `git -C "${resolvedProjectPath}" branch -D "${branchName}"`,
        { timeout: 10000 }
      );
    } catch {
      // Ignore branch deletion errors (might be merged or checked out elsewhere)
    }
  }
}

/**
 * List all worktrees for a project
 */
export async function listWorktrees(
  projectPath: string
): Promise<
  Array<{
    path: string;
    branch: string;
    head: string;
  }>
> {
  const resolvedProjectPath = resolvePath(projectPath);

  try {
    const { stdout } = await execAsync(
      `git -C "${resolvedProjectPath}" worktree list --porcelain`,
      { timeout: 10000 }
    );

    const worktrees: Array<{ path: string; branch: string; head: string }> = [];
    const entries = stdout.split("\n\n").filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split("\n");
      let worktreePath = "";
      let branch = "";
      let head = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktreePath = line.slice(9);
        } else if (line.startsWith("branch ")) {
          branch = line.slice(7).replace("refs/heads/", "");
        } else if (line.startsWith("HEAD ")) {
          head = line.slice(5);
        }
      }

      if (worktreePath) {
        worktrees.push({ path: worktreePath, branch, head });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Check if a path is inside an AgentOS worktree
 */
export function isAgentOSWorktree(worktreePath: string): boolean {
  const resolvedPath = resolvePath(worktreePath);
  return resolvedPath.startsWith(WORKTREES_DIR);
}

/**
 * Get the worktrees base directory
 */
export function getWorktreesDir(): string {
  return WORKTREES_DIR;
}
