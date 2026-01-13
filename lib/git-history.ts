import { execSync } from "child_process";
import { expandPath } from "./git-status";

export interface CommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  timestamp: number;
  relativeTime: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface CommitFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface CommitDetail extends CommitSummary {
  files: CommitFile[];
}

/**
 * Get relative time string from timestamp
 */
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/**
 * Get commit history
 */
export function getCommitHistory(
  workingDir: string,
  limit: number = 30
): CommitSummary[] {
  const cwd = expandPath(workingDir);

  try {
    // Format: hash|shortHash|subject|body|author|email|timestamp
    // Using %x00 as separator to handle commit messages with |
    const format = "%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%at";
    const output = execSync(
      `git log --format="${format}" -n ${limit} --shortstat`,
      { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    );

    const commits: CommitSummary[] = [];
    const lines = output.split("\n");

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line || !line.includes("\x00")) {
        i++;
        continue;
      }

      const parts = line.split("\x00");
      if (parts.length < 7) {
        i++;
        continue;
      }

      const [hash, shortHash, subject, body, author, authorEmail, timestampStr] =
        parts;
      const timestamp = parseInt(timestampStr, 10);

      // Look for shortstat line (next non-empty line)
      let filesChanged = 0;
      let additions = 0;
      let deletions = 0;

      i++;
      while (i < lines.length) {
        const statLine = lines[i].trim();
        if (!statLine) {
          i++;
          continue;
        }
        // Parse shortstat: "3 files changed, 10 insertions(+), 5 deletions(-)"
        const filesMatch = statLine.match(/(\d+) files? changed/);
        const addMatch = statLine.match(/(\d+) insertions?\(\+\)/);
        const delMatch = statLine.match(/(\d+) deletions?\(-\)/);

        if (filesMatch || addMatch || delMatch) {
          filesChanged = filesMatch ? parseInt(filesMatch[1], 10) : 0;
          additions = addMatch ? parseInt(addMatch[1], 10) : 0;
          deletions = delMatch ? parseInt(delMatch[1], 10) : 0;
          i++;
          break;
        }
        // If line contains separator, it's a new commit
        if (statLine.includes("\x00")) {
          break;
        }
        i++;
      }

      commits.push({
        hash,
        shortHash,
        subject,
        body: body.trim(),
        author,
        authorEmail,
        timestamp,
        relativeTime: getRelativeTime(timestamp),
        filesChanged,
        additions,
        deletions,
      });
    }

    return commits;
  } catch (error) {
    console.error("Failed to get commit history:", error);
    return [];
  }
}

/**
 * Get detailed commit info including files changed
 */
export function getCommitDetail(
  workingDir: string,
  commitHash: string
): CommitDetail | null {
  const cwd = expandPath(workingDir);

  try {
    // Get commit info
    const format = "%H%x00%h%x00%s%x00%b%x00%an%x00%ae%x00%at";
    const infoOutput = execSync(`git show --format="${format}" -s ${commitHash}`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    const parts = infoOutput.split("\x00");
    if (parts.length < 7) return null;

    const [hash, shortHash, subject, body, author, authorEmail, timestampStr] =
      parts;
    const timestamp = parseInt(timestampStr, 10);

    // Get file stats using numstat
    const statOutput = execSync(
      `git show --numstat --format="" ${commitHash}`,
      { cwd, encoding: "utf-8" }
    );

    // Get name-status for detecting renames
    const nameStatusOutput = execSync(
      `git show --name-status --format="" ${commitHash}`,
      { cwd, encoding: "utf-8" }
    );

    const files: CommitFile[] = [];
    const statLines = statOutput.trim().split("\n").filter(Boolean);
    const nameStatusLines = nameStatusOutput.trim().split("\n").filter(Boolean);

    // Build a map of path -> status from name-status
    const statusMap = new Map<string, { status: string; oldPath?: string }>();
    for (const line of nameStatusLines) {
      const match = line.match(/^([AMDRC])\d*\t(.+?)(?:\t(.+))?$/);
      if (match) {
        const [, status, path1, path2] = match;
        const finalPath = path2 || path1;
        statusMap.set(finalPath, {
          status,
          oldPath: path2 ? path1 : undefined,
        });
      }
    }

    // Parse numstat for additions/deletions
    for (const line of statLines) {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const [, addStr, delStr, path] = match;
        const additions = addStr === "-" ? 0 : parseInt(addStr, 10);
        const deletions = delStr === "-" ? 0 : parseInt(delStr, 10);

        const statusInfo = statusMap.get(path);
        let status: CommitFile["status"] = "modified";
        if (statusInfo) {
          switch (statusInfo.status) {
            case "A":
              status = "added";
              break;
            case "D":
              status = "deleted";
              break;
            case "R":
              status = "renamed";
              break;
            default:
              status = "modified";
          }
        }

        files.push({
          path,
          oldPath: statusInfo?.oldPath,
          status,
          additions,
          deletions,
        });
      }
    }

    // Get total stats
    let totalFilesChanged = files.length;
    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const file of files) {
      totalAdditions += file.additions;
      totalDeletions += file.deletions;
    }

    return {
      hash,
      shortHash,
      subject,
      body: body.trim(),
      author,
      authorEmail,
      timestamp,
      relativeTime: getRelativeTime(timestamp),
      filesChanged: totalFilesChanged,
      additions: totalAdditions,
      deletions: totalDeletions,
      files,
    };
  } catch (error) {
    console.error("Failed to get commit detail:", error);
    return null;
  }
}

/**
 * Get diff for a specific file in a commit
 */
export function getCommitFileDiff(
  workingDir: string,
  commitHash: string,
  filePath: string
): string {
  const cwd = expandPath(workingDir);

  try {
    // Get diff for the specific file in this commit
    // Use -m to handle merge commits (shows diff against first parent)
    const diff = execSync(
      `git show -m --first-parent ${commitHash} -- "${filePath}"`,
      { cwd, encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 }
    );
    return diff;
  } catch (error) {
    console.error("Failed to get commit file diff:", error);
    return "";
  }
}
