import { realpathSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { homedir } from "os";
import {
  currentBranch as readBranch,
  git as runGit,
  gitOk,
  gitPush,
  gitResult,
  type GitOptions,
} from "./git-exec";

// The reads the git panel polls, and its stage/unstage/discard: paths are
// names, never globs or pathspec magic, so "[draft].md" or "*" can't reach
// other files. A hung git fails the request at 30s.
const READ: GitOptions = { literalPathspecs: true, timeout: 30_000 };
const git = (cwd: string, args: string[]) => runGit(cwd, args, READ);

// For commands whose exit code isn't failure (a diff with changes exits 1):
// whatever they printed, or nothing.
async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" ? stdout : "";
  }
}

// A commit or push can wait on a hook or a remote.
const WRITE: GitOptions = { timeout: 120_000 };

/**
 * Expand ~ to home directory in paths
 */
export function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace(/^~/, homedir());
  }
  return path;
}

export type FileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged";

export interface GitFile {
  path: string;
  status: FileStatus;
  staged: boolean;
  oldPath?: string; // For renamed files
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
}

/**
 * Parse git status --porcelain=v2 output
 */
export async function getGitStatus(workingDir: string): Promise<GitStatus> {
  try {
    const [branchOutput, trackingOutput, statusOutput] = await Promise.all([
      git(workingDir, ["branch", "--show-current"]).then((o) => o.trim()),
      // No upstream configured: nothing ahead or behind.
      git(workingDir, [
        "rev-list",
        "--left-right",
        "--count",
        "@{upstream}...HEAD",
      ]).then(
        (o) => o.trim(),
        () => "0 0"
      ),
      git(workingDir, ["status", "--porcelain=v1"]),
    ]);
    const [b, a] = trackingOutput.split(/\s+/).map(Number);
    const ahead = a || 0;
    const behind = b || 0;

    const staged: GitFile[] = [];
    const unstaged: GitFile[] = [];
    const untracked: GitFile[] = [];

    for (const line of statusOutput.split("\n")) {
      if (!line) continue;

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const filePath = line.slice(3);

      // Handle renames (format: "R  old -> new")
      let path = filePath;
      let oldPath: string | undefined;
      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        oldPath = parts[0];
        path = parts[1];
      }

      // Untracked files
      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.push({ path, status: "untracked", staged: false });
        continue;
      }

      // Staged changes (index status)
      if (indexStatus !== " " && indexStatus !== "?") {
        staged.push({
          path,
          oldPath,
          status: parseStatus(indexStatus),
          staged: true,
        });
      }

      // Unstaged changes (work tree status)
      if (workTreeStatus !== " " && workTreeStatus !== "?") {
        unstaged.push({
          path,
          oldPath,
          status: parseStatus(workTreeStatus),
          staged: false,
        });
      }
    }

    return {
      branch: branchOutput || "HEAD",
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
    };
  } catch (error) {
    throw new Error(
      `Failed to get git status: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function parseStatus(char: string): FileStatus {
  switch (char) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    default:
      return "modified";
  }
}

/**
 * Get diff for a specific file
 */
export async function getFileDiff(
  workingDir: string,
  filePath: string,
  staged: boolean
): Promise<string> {
  return gitOutput(workingDir, [
    "diff",
    ...(staged ? ["--staged"] : []),
    "--",
    filePath,
  ]);
}

/**
 * Get diff for untracked file (show full content)
 */
export async function getUntrackedFileDiff(
  workingDir: string,
  filePath: string
): Promise<string> {
  return gitOutput(workingDir, [
    "diff",
    "--no-index",
    "--",
    "/dev/null",
    filePath,
  ]);
}

// File paths come from the repository's own file names: they go to git as
// arguments, never through a shell.

/**
 * Stage a file
 */
export async function stageFile(
  workingDir: string,
  filePath: string
): Promise<void> {
  await git(workingDir, ["add", "--", filePath]);
}

/**
 * Stage all files
 */
export async function stageAll(workingDir: string): Promise<void> {
  await git(workingDir, ["add", "-A"]);
}

/**
 * Unstage a file
 */
export async function unstageFile(
  workingDir: string,
  filePath: string
): Promise<void> {
  await git(workingDir, ["reset", "HEAD", "--", filePath]);
}

/**
 * Unstage all files
 */
export async function unstageAll(workingDir: string): Promise<void> {
  await git(workingDir, ["reset", "HEAD"]);
}

/**
 * Discard changes to a file (checkout for tracked, delete for untracked)
 */
export async function discardChanges(
  workingDir: string,
  filePath: string
): Promise<void> {
  // Tracked or not is read from what git lists, not from a failed command:
  // a checkout that failed (a held lock, a timeout) must not fall through to
  // deleting a tracked file. A path outside the repo fails here too.
  const tracked = await git(workingDir, ["ls-files", "-z", "--", filePath]);
  if (tracked) {
    await git(workingDir, ["checkout", "--", filePath]);
    return;
  }
  // Untracked: delete it only if git lists it as untracked and not ignored
  // (never .git's own files or an ignored .env), and only inside the repo.
  const untracked = await git(workingDir, [
    "ls-files",
    "-z",
    "--others",
    "--exclude-standard",
    "--",
    filePath,
  ]);
  if (!untracked) throw new Error("Nothing to discard");
  const root = realpathSync(workingDir);
  const target = resolve(root, filePath);
  const inside = join(realpathSync(dirname(target)), basename(target));
  if (!inside.startsWith(root + sep))
    throw new Error("Path outside repository");
  unlinkSync(inside);
}

export { isGitRepo } from "./git";

/**
 * Get the root of the git repository
 */
export async function getGitRoot(workingDir: string): Promise<string> {
  try {
    return (await runGit(workingDir, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return workingDir;
  }
}

/**
 * Check if on main/master branch
 */
export async function isMainBranch(workingDir: string): Promise<boolean> {
  try {
    const branch = await readBranch(workingDir);
    return branch === "main" || branch === "master";
  } catch {
    return false;
  }
}

/**
 * A name `git checkout -b` takes as a branch and nothing else: no option
 * ("-f", "--orphan=x"), nothing git itself refuses as a ref.
 */
export async function isValidBranchName(
  workingDir: string,
  name: string
): Promise<boolean> {
  if (!name || name.startsWith("-")) return false;
  return gitOk(workingDir, ["check-ref-format", "--branch", name]);
}

/**
 * Create a new branch and switch to it
 */
export async function createBranch(
  workingDir: string,
  branchName: string
): Promise<void> {
  if (!(await isValidBranchName(workingDir, branchName))) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }
  await runGit(workingDir, ["checkout", "-b", branchName, "--"]);
}

/**
 * Commit staged changes. The message goes on stdin, so nothing in it is
 * read by a shell or as an option.
 */
export async function commit(
  workingDir: string,
  message: string
): Promise<string> {
  const { stdout } = await gitResult(workingDir, ["commit", "-F", "-"], {
    ...WRITE,
    input: message,
  });
  return stdout;
}

/**
 * Push to remote
 */
export async function push(
  workingDir: string,
  setUpstream = false
): Promise<string> {
  const args = ["push"];
  if (setUpstream) {
    const branch = await readBranch(workingDir);
    if (!(await isValidBranchName(workingDir, branch))) {
      throw new Error(`Can't push from "${branch || "a detached HEAD"}"`);
    }
    args.push("-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`);
  }
  // git push reports progress and the remote's messages on stderr.
  return gitPush(workingDir, args.slice(1), WRITE);
}

/**
 * Check if branch has upstream
 */
export function hasUpstream(workingDir: string): Promise<boolean> {
  return gitOk(workingDir, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
}

/**
 * Get remote URL
 */
export async function getRemoteUrl(workingDir: string): Promise<string | null> {
  try {
    return (await runGit(workingDir, ["remote", "get-url", "origin"])).trim();
  } catch {
    return null;
  }
}
