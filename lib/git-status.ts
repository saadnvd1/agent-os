import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { realpathSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { homedir } from "os";

const execFileAsync = promisify(execFile);

// The reads the git panel polls run off the event loop: a slow repo
// shouldn't stall every terminal and status push while git works.
async function git(cwd: string, args: string[]): Promise<string> {
  // Paths are names, never globs or pathspec magic: "[draft].md" or "*"
  // must not reach other files.
  const { stdout } = await execFileAsync(
    "git",
    ["--literal-pathspecs", ...args],
    {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      // A hung git (a stalled mount, a stuck hook) fails the request instead.
      timeout: 30_000,
      killSignal: "SIGKILL",
    }
  );
  return stdout;
}

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
  return gitOutput(workingDir, ["diff", "--no-index", "/dev/null", filePath]);
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

/**
 * Check if directory is a git repository
 */
export async function isGitRepo(workingDir: string): Promise<boolean> {
  try {
    await git(workingDir, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root of the git repository
 */
export function getGitRoot(workingDir: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return workingDir;
  }
}

/**
 * Check if on main/master branch
 */
export function isMainBranch(workingDir: string): boolean {
  try {
    const branch = execSync("git branch --show-current", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();
    return branch === "main" || branch === "master";
  } catch {
    return false;
  }
}

/**
 * Create a new branch and switch to it
 */
export function createBranch(workingDir: string, branchName: string): void {
  execSync(`git checkout -b "${branchName}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Commit staged changes
 */
export function commit(workingDir: string, message: string): string {
  const output = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
  return output;
}

/**
 * Push to remote
 */
export function push(workingDir: string, setUpstream = false): string {
  const branch = execSync("git branch --show-current", {
    cwd: workingDir,
    encoding: "utf-8",
  }).trim();

  const upstreamFlag = setUpstream ? `-u origin "${branch}"` : "";
  const output = execSync(`git push ${upstreamFlag}`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
  return output;
}

/**
 * Check if branch has upstream
 */
export function hasUpstream(workingDir: string): boolean {
  try {
    execSync("git rev-parse --abbrev-ref @{upstream}", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get remote URL
 */
export function getRemoteUrl(workingDir: string): string | null {
  try {
    return execSync("git remote get-url origin", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the default branch name (main or master)
 */
export function getDefaultBranch(workingDir: string): string {
  try {
    // Try to get from remote
    const output = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo 'refs/heads/main'",
      { cwd: workingDir, encoding: "utf-8" }
    ).trim();
    return output
      .replace("refs/remotes/origin/", "")
      .replace("refs/heads/", "");
  } catch {
    return "main";
  }
}
