import { execSync } from "child_process";

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
export function getGitStatus(workingDir: string): GitStatus {
  try {
    // Get branch info
    const branchOutput = execSync("git branch --show-current", {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();

    // Get ahead/behind counts
    let ahead = 0;
    let behind = 0;
    try {
      const trackingOutput = execSync(
        "git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo '0 0'",
        { cwd: workingDir, encoding: "utf-8" }
      ).trim();
      const [b, a] = trackingOutput.split(/\s+/).map(Number);
      ahead = a || 0;
      behind = b || 0;
    } catch {
      // No upstream configured
    }

    // Get status
    const statusOutput = execSync("git status --porcelain=v1", {
      cwd: workingDir,
      encoding: "utf-8",
    });

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
export function getFileDiff(
  workingDir: string,
  filePath: string,
  staged: boolean
): string {
  try {
    const stagedFlag = staged ? "--staged" : "";
    const output = execSync(
      `git diff ${stagedFlag} -- "${filePath}" 2>/dev/null || true`,
      {
        cwd: workingDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }
    );
    return output;
  } catch {
    return "";
  }
}

/**
 * Get diff for untracked file (show full content)
 */
export function getUntrackedFileDiff(
  workingDir: string,
  filePath: string
): string {
  try {
    const output = execSync(`git diff --no-index /dev/null "${filePath}" 2>/dev/null || true`, {
      cwd: workingDir,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return output;
  } catch {
    return "";
  }
}

/**
 * Stage a file
 */
export function stageFile(workingDir: string, filePath: string): void {
  execSync(`git add -- "${filePath}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Stage all files
 */
export function stageAll(workingDir: string): void {
  execSync("git add -A", {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Unstage a file
 */
export function unstageFile(workingDir: string, filePath: string): void {
  execSync(`git reset HEAD -- "${filePath}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Unstage all files
 */
export function unstageAll(workingDir: string): void {
  execSync("git reset HEAD", {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Discard changes to a file (checkout)
 */
export function discardChanges(workingDir: string, filePath: string): void {
  execSync(`git checkout -- "${filePath}"`, {
    cwd: workingDir,
    encoding: "utf-8",
  });
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(workingDir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", {
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
