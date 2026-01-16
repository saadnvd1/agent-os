import { execSync } from "child_process";

/**
 * Check if ripgrep is available on the system
 */
export function isRipgrepAvailable(): boolean {
  try {
    execSync("which rg", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export interface SearchOptions {
  maxResults?: number;
  contextLines?: number;
  filePattern?: string;
  caseSensitive?: boolean;
}

export interface SearchMatch {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

export interface FormattedMatch {
  file: string;
  line: number;
  column: number;
  matchText: string;
  lineText: string;
}

export function searchCode(
  workingDir: string,
  query: string,
  options: SearchOptions = {}
): SearchMatch[] {
  const {
    maxResults = 100,
    contextLines = 2,
    filePattern = "*",
    caseSensitive = false,
  } = options;

  try {
    // Use spawn instead of execSync for better control
    const { spawnSync } = require("child_process");

    const args = [
      "--json",
      `--max-count=${Math.ceil(maxResults / 10)}`,
      `--context=${contextLines}`,
      "--ignore-case",
      query,
      ".", // CRITICAL: Tell ripgrep to search current directory explicitly
    ];

    const result = spawnSync("rg", args, {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 1024 * 1024 * 5,
      stdio: ["ignore", "pipe", "pipe"], // Ignore stdin so ripgrep doesn't wait for it
    });

    if (result.error) {
      throw result.error;
    }

    // Status 1 = no matches (not an error for ripgrep)
    if (result.status !== 0 && result.status !== 1) {
      return [];
    }

    const output = result.stdout || "";
    const matches: SearchMatch[] = [];
    const lines = output.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          matches.push(parsed);
          if (matches.length >= maxResults) break;
        }
      } catch {
        continue;
      }
    }

    return matches;
  } catch (error) {
    console.error("Error in searchCode:", error);
    // ENOENT = command not found
    if ((error as any).code === "ENOENT") {
      throw new Error(
        "ripgrep (rg) not found. Install with: brew install ripgrep"
      );
    }
    // Other errors - return empty
    return [];
  }
}

export function formatSearchResults(matches: SearchMatch[]): FormattedMatch[] {
  return matches.map((match) => ({
    file: match.data.path.text,
    line: match.data.line_number,
    column: match.data.submatches[0]?.start || 0,
    matchText: match.data.submatches[0]?.match.text || "",
    lineText: match.data.lines.text,
  }));
}
