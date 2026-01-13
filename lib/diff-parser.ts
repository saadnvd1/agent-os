/**
 * Unified diff parser
 * Parses git diff output into structured data
 */

export interface DiffLine {
  type: "context" | "addition" | "deletion" | "header";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
}

/**
 * Parse a unified diff string into structured data
 */
export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");

  let oldFile = "";
  let newFile = "";
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let additions = 0;
  let deletions = 0;
  let isBinary = false;
  let isNew = false;
  let isDeleted = false;
  let isRenamed = false;

  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Binary file detection
    if (line.startsWith("Binary files")) {
      isBinary = true;
      continue;
    }

    // Old file header
    if (line.startsWith("--- ")) {
      oldFile = line.slice(4);
      if (oldFile === "/dev/null") {
        isNew = true;
      }
      // Strip a/ prefix
      if (oldFile.startsWith("a/")) {
        oldFile = oldFile.slice(2);
      }
      continue;
    }

    // New file header
    if (line.startsWith("+++ ")) {
      newFile = line.slice(4);
      if (newFile === "/dev/null") {
        isDeleted = true;
      }
      // Strip b/ prefix
      if (newFile.startsWith("b/")) {
        newFile = newFile.slice(2);
      }
      continue;
    }

    // Rename detection
    if (line.startsWith("rename from ") || line.startsWith("rename to ")) {
      isRenamed = true;
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      const oldStart = parseInt(hunkMatch[1], 10);
      const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;
      const context = hunkMatch[5] || "";

      currentHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
      };

      // Add header line with context (function name, etc.)
      if (context.trim()) {
        currentHunk.lines.push({
          type: "header",
          content: context.trim(),
          oldLineNumber: null,
          newLineNumber: null,
        });
      }

      oldLineNum = oldStart;
      newLineNum = newStart;
      continue;
    }

    // Inside a hunk
    if (currentHunk) {
      if (line.startsWith("+")) {
        currentHunk.lines.push({
          type: "addition",
          content: line.slice(1),
          oldLineNumber: null,
          newLineNumber: newLineNum,
        });
        newLineNum++;
        additions++;
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({
          type: "deletion",
          content: line.slice(1),
          oldLineNumber: oldLineNum,
          newLineNumber: null,
        });
        oldLineNum++;
        deletions++;
      } else if (line.startsWith(" ") || line === "") {
        // Context line or empty
        const content = line.startsWith(" ") ? line.slice(1) : line;
        currentHunk.lines.push({
          type: "context",
          content,
          oldLineNumber: oldLineNum,
          newLineNumber: newLineNum,
        });
        oldLineNum++;
        newLineNum++;
      }
      // Skip other lines like "\ No newline at end of file"
    }
  }

  // Don't forget the last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return {
    oldFile,
    newFile,
    hunks,
    additions,
    deletions,
    isBinary,
    isNew,
    isDeleted,
    isRenamed,
  };
}

/**
 * Get a summary string for a diff
 */
export function getDiffSummary(diff: ParsedDiff): string {
  if (diff.isBinary) {
    return "Binary file";
  }
  if (diff.isNew) {
    return `New file (+${diff.additions})`;
  }
  if (diff.isDeleted) {
    return `Deleted (-${diff.deletions})`;
  }
  if (diff.isRenamed) {
    return `Renamed (+${diff.additions}, -${diff.deletions})`;
  }
  return `+${diff.additions}, -${diff.deletions}`;
}

/**
 * Get file name from diff (handles renames)
 */
export function getDiffFileName(diff: ParsedDiff): string {
  if (diff.isNew) {
    return diff.newFile;
  }
  if (diff.isDeleted) {
    return diff.oldFile;
  }
  if (diff.isRenamed) {
    return `${diff.oldFile} → ${diff.newFile}`;
  }
  return diff.newFile || diff.oldFile;
}
