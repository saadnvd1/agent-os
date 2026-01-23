/**
 * Git Worktree management for isolated feature development
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execForProject } from "./exec-wrapper";
import {
  isGitRepo,
  branchExists,
  getRepoName,
  slugify,
  generateBranchName,
} from "./git";

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
function generateWorktreeDirName(
  projectName: string,
  featureName: string
): string {
  const featureSlug = slugify(featureName);
  return `${projectName}-${featureSlug}`;
}

/**
 * Create a new worktree for a feature branch
 */
export async function createWorktree(
  projectId: string,
  options: CreateWorktreeOptions
): Promise<WorktreeInfo> {
  const { projectPath, featureName, baseBranch = "main" } = options;

  const resolvedProjectPath = resolvePath(projectPath);

  // Validate project is a git repo
  if (!(await isGitRepo(projectId, resolvedProjectPath))) {
    throw new Error(`Not a git repository: ${projectPath}`);
  }

  // Generate branch name
  const branchName = generateBranchName(featureName);

  // Check if branch already exists
  if (await branchExists(projectId, resolvedProjectPath, branchName)) {
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
  // Try multiple ref formats to avoid "ambiguous refname" errors
  const refFormats = [
    `origin/${baseBranch}`, // Try remote first (most explicit)
    `refs/heads/${baseBranch}`, // Then local branch
    baseBranch, // Finally, bare name as fallback
  ];

  let lastError: Error | null = null;
  for (const ref of refFormats) {
    try {
      await execForProject(
        projectId,
        `git worktree add -b "${branchName}" "${worktreePath}" "${ref}"`,
        {
          cwd: resolvedProjectPath,
          timeout: 30000,
        }
      );
      lastError = null;
      break; // Success!
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Continue to next ref format
    }
  }

  if (lastError) {
    throw new Error(`Failed to create worktree: ${lastError.message}`);
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
  projectId: string,
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
      const { stdout } = await execForProject(
        projectId,
        "git rev-parse --abbrev-ref HEAD",
        {
          cwd: resolvedWorktreePath,
          timeout: 5000,
        }
      );
      branchName = stdout.trim();
    } catch {
      // Ignore - worktree might already be gone
    }
  }

  // Remove the worktree
  try {
    await execForProject(
      projectId,
      `git worktree remove "${resolvedWorktreePath}" --force`,
      {
        cwd: resolvedProjectPath,
        timeout: 30000,
      }
    );
  } catch {
    // If git worktree remove fails, try manual cleanup
    if (fs.existsSync(resolvedWorktreePath)) {
      await fs.promises.rm(resolvedWorktreePath, {
        recursive: true,
        force: true,
      });
    }
    // Prune worktree references
    try {
      await execForProject(projectId, "git worktree prune", {
        cwd: resolvedProjectPath,
        timeout: 10000,
      });
    } catch {
      // Ignore prune errors
    }
  }

  // Optionally delete the branch
  if (
    deleteBranch &&
    branchName &&
    branchName !== "main" &&
    branchName !== "master"
  ) {
    try {
      await execForProject(projectId, `git branch -D "${branchName}"`, {
        cwd: resolvedProjectPath,
        timeout: 10000,
      });
    } catch {
      // Ignore branch deletion errors (might be merged or checked out elsewhere)
    }
  }
}

/**
 * List all worktrees for a project
 */
export async function listWorktrees(
  projectId: string,
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
    const { stdout } = await execForProject(
      projectId,
      "git worktree list --porcelain",
      {
        cwd: resolvedProjectPath,
        timeout: 10000,
      }
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
