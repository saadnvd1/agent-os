/**
 * Git Worktree management for isolated feature development
 */

import { execFile } from "child_process";
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

const execFileAsync = promisify(execFile);

const git = (cwd: string, args: string[], timeout: number) =>
  execFileAsync("git", ["-C", cwd, ...args], { timeout });

/**
 * The main checkout a worktree belongs to, or "" when it can't be read.
 */
export async function mainCheckoutOf(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await git(
      worktreePath,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      5000
    );
    return stdout.trim().replace(/\/\.git$/, "");
  } catch {
    return "";
  }
}

// Base directory for all worktrees
export const WORKTREES_DIR = path.join(os.homedir(), ".agent-os", "worktrees");

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
  // Cut from this exact commit instead of the base branch's tip.
  startPoint?: string;
  // How long one `git worktree add` may take; scales with load by default.
  timeoutMs?: number;
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

// Where createWorktree puts a feature's worktree, known before it exists.
export function worktreePathFor(projectPath: string, featureName: string) {
  const projectName = getRepoName(resolvePath(projectPath));
  return path.join(
    WORKTREES_DIR,
    generateWorktreeDirName(projectName, featureName)
  );
}

/**
 * Create a new worktree for a feature branch
 */
export async function createWorktree(
  options: CreateWorktreeOptions
): Promise<WorktreeInfo> {
  const { projectPath, featureName, baseBranch = "main", startPoint } = options;

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
  const worktreePath = worktreePathFor(projectPath, featureName);

  // Ensure worktrees directory exists
  await ensureWorktreesDir();

  // Create the worktree with a new branch
  // Try multiple ref formats to avoid "ambiguous refname" errors
  const refFormats = startPoint
    ? [startPoint]
    : [
        `origin/${baseBranch}`, // Try remote first (most explicit)
        `refs/heads/${baseBranch}`, // Then local branch
        baseBranch, // Finally, bare name as fallback
      ];

  const timeout = options.timeoutMs ?? worktreeAddTimeout();
  const errors: Error[] = [];
  for (const [i, ref] of refFormats.entries()) {
    // The path is claimed (an empty folder, which git accepts) before each
    // try, so a start racing this one fails here, and the cleanup below
    // only ever removes what this call made.
    if (!(await claim(worktreePath))) {
      if (i === 0)
        throw new Error(`Worktree path already exists: ${worktreePath}`);
      break;
    }
    try {
      await git(
        resolvedProjectPath,
        ["worktree", "add", "-b", branchName, "--", worktreePath, ref],
        timeout
      );
      return {
        worktreePath,
        branchName,
        baseBranch,
        projectPath: resolvedProjectPath,
        projectName,
      };
    } catch (error: unknown) {
      const failed = describeAddError(error, timeout);
      errors.push(failed);
      // A failed add can still have made the branch and part of the
      // worktree, which would fail every later try with "already exists".
      // "Already exists" means the branch isn't this try's to delete.
      await undoFailedAdd(resolvedProjectPath, worktreePath, branchName, ref, {
        keepBranch: /already exists/i.test(failed.message),
      });
      // A timeout is the machine, not the ref: another try only waits again.
      if (isTimeout(error)) break;
    }
  }
  throw new Error(
    `Failed to create worktree: ${firstRealError(errors).message}`
  );
}

const claim = (dir: string) =>
  fs.promises.mkdir(dir).then(
    () => true,
    () => false
  );

const ADD_TIMEOUT_MS = 120_000;
const MAX_ADD_TIMEOUT_MS = 600_000;

// Two minutes, longer when the machine is loaded past its cores.
export function worktreeAddTimeout(
  load = os.loadavg()[0],
  cores = os.cpus().length || 1
): number {
  const scale = Math.max(1, load / cores);
  return Math.min(MAX_ADD_TIMEOUT_MS, Math.round(ADD_TIMEOUT_MS * scale));
}

const isTimeout = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  (error as { killed?: boolean }).killed === true;

function describeAddError(error: unknown, timeout: number): Error {
  if (isTimeout(error))
    return new Error(
      `git worktree add timed out after ${Math.round(timeout / 1000)}s`
    );
  return error instanceof Error ? error : new Error(String(error));
}

// A ref that doesn't resolve is the expected miss of a fallback; anything
// else is what actually went wrong, and the first one is the cause.
const isMissingRef = (e: Error) =>
  /invalid reference|not a valid (object|commit)|ambiguous/i.test(e.message);

export function firstRealError(errors: Error[]): Error {
  return errors.find((e) => !isMissingRef(e)) ?? errors[errors.length - 1];
}

// Removes what a failed add left: its worktree (at a path this call
// claimed) and its branch, only while the branch is still exactly its start
// point, so nothing committed on it is ever deleted.
async function undoFailedAdd(
  repo: string,
  worktreePath: string,
  branch: string,
  ref: string,
  { keepBranch }: { keepBranch: boolean }
): Promise<void> {
  const quiet = (args: string[]) => git(repo, args, 30000).catch(() => null);
  // Twice forced: an add cut short leaves its worktree locked.
  await quiet(["worktree", "remove", "-f", "-f", "--", worktreePath]);
  await fs.promises
    .rm(worktreePath, { recursive: true, force: true })
    .catch(() => {});
  await quiet(["worktree", "unlock", "--", worktreePath]);
  await quiet(["worktree", "prune"]);
  if (keepBranch) return;
  const tip = await quiet([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  if (!tip) return;
  const start = await quiet([
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  if (start && tip.stdout.trim() === start.stdout.trim())
    await quiet(["branch", "-D", "--", branch]);
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
      const { stdout } = await git(
        resolvedWorktreePath,
        ["rev-parse", "--abbrev-ref", "HEAD"],
        5000
      );
      branchName = stdout.trim();
    } catch {
      // Ignore - worktree might already be gone
    }
  }

  // Remove the worktree
  try {
    await git(
      resolvedProjectPath,
      ["worktree", "remove", "--force", "--", resolvedWorktreePath],
      30000
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
      await git(resolvedProjectPath, ["worktree", "prune"], 10000);
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
      await git(resolvedProjectPath, ["branch", "-D", "--", branchName], 10000);
    } catch {
      // Ignore branch deletion errors (might be merged or checked out elsewhere)
    }
  }
}

/**
 * List all worktrees for a project
 */
export async function listWorktrees(projectPath: string): Promise<
  Array<{
    path: string;
    branch: string;
    head: string;
  }>
> {
  const resolvedProjectPath = resolvePath(projectPath);

  try {
    const { stdout } = await git(
      resolvedProjectPath,
      ["worktree", "list", "--porcelain"],
      10000
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
