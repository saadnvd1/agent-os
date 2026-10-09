import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { realpathSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { homedir } from "os";
import { remoteDefaultBranch } from "./pr";

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
      // Status reads never take the index lock a commit or rebase needs.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
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

// Writes and the few sync reads: argv only, never a shell, so a branch name,
// a commit message or a path is always data.
function gitSync(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Get the root of the git repository
 */
export function getGitRoot(workingDir: string): string {
  try {
    return gitSync(workingDir, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return workingDir;
  }
}

function currentBranch(workingDir: string): string {
  return gitSync(workingDir, ["branch", "--show-current"]).trim();
}

/**
 * Check if on main/master branch
 */
export function isMainBranch(workingDir: string): boolean {
  try {
    const branch = currentBranch(workingDir);
    return branch === "main" || branch === "master";
  } catch {
    return false;
  }
}

/**
 * A name `git checkout -b` takes as a branch and nothing else: no option
 * ("-f", "--orphan=x"), nothing git itself refuses as a ref.
 */
export function isValidBranchName(workingDir: string, name: string): boolean {
  if (!name || name.startsWith("-")) return false;
  try {
    gitSync(workingDir, ["check-ref-format", "--branch", name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new branch and switch to it
 */
export function createBranch(workingDir: string, branchName: string): void {
  if (!isValidBranchName(workingDir, branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }
  gitSync(workingDir, ["checkout", "-b", branchName, "--"]);
}

// A commit or push can wait on a hook or a remote: off the event loop, with a
// ceiling (a hung ssh is killed at it), and no git credential prompt.
function gitWrite(
  cwd: string,
  args: string[],
  input?: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
        killSignal: "SIGKILL",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, stderr });
        // "nothing to commit" is on stdout.
        const reason = stderr.trim() || stdout.trim() || error.message;
        reject(new Error(`git ${args[0]} failed: ${reason}`));
      }
    );
    // git exiting before it read the message is its failure, not a crash.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

/**
 * Commit staged changes. The message goes on stdin, so nothing in it is
 * read by a shell or as an option.
 */
export async function commit(
  workingDir: string,
  message: string
): Promise<string> {
  return (await gitWrite(workingDir, ["commit", "-F", "-"], message)).stdout;
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
    const branch = currentBranch(workingDir);
    if (!isValidBranchName(workingDir, branch)) {
      throw new Error(`Can't push from "${branch || "a detached HEAD"}"`);
    }
    args.push("-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`);
  }
  // git push reports progress and the remote's messages on stderr.
  const { stdout, stderr } = await gitWrite(workingDir, args);
  return `${stdout}${stderr}`;
}

/**
 * Check if branch has upstream
 */
export function hasUpstream(workingDir: string): boolean {
  try {
    gitSync(workingDir, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
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
    return gitSync(workingDir, ["remote", "get-url", "origin"]).trim();
  } catch {
    return null;
  }
}

/**
 * Get the default branch name (main or master)
 */
export function getDefaultBranch(workingDir: string): string {
  return remoteDefaultBranch(workingDir);
}
