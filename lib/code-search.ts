import { execFile, spawn } from "child_process";
import { createInterface } from "readline";

// rg runs off the event loop: a search over a big tree never stalls the
// server's other requests. It stops at the result cap, the output cap or the
// timeout, whichever comes first, and when the caller aborts.
export const SEARCH_TIMEOUT_MS = 10_000;
export const MAX_RESULTS_CAP = 500;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

let ripgrepFound = false;

/**
 * Check if ripgrep is available on the system. A yes is remembered; a no is
 * asked again, so installing it counts without a restart.
 */
export async function isRipgrepAvailable(): Promise<boolean> {
  if (ripgrepFound) return true;
  ripgrepFound = await new Promise<boolean>((resolve) => {
    execFile("rg", ["--version"], { timeout: 5000 }, (error) =>
      resolve(!error)
    );
  });
  return ripgrepFound;
}

export interface SearchOptions {
  maxResults?: number;
  contextLines?: number;
  filePattern?: string;
  caseSensitive?: boolean;
  /** Stops rg (the request went away). */
  signal?: AbortSignal;
  timeoutMs?: number;
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

export async function searchCode(
  workingDir: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchMatch[]> {
  const { contextLines = 2, signal, timeoutMs = SEARCH_TIMEOUT_MS } = options;
  const maxResults = Math.min(options.maxResults ?? 100, MAX_RESULTS_CAP);

  const args = [
    "--json",
    `--max-count=${Math.ceil(maxResults / 10)}`,
    `--context=${contextLines}`,
    "--ignore-case",
    // -e: a query starting with "-" is a pattern, never an option (--pre).
    "-e",
    query,
    "--",
    ".", // CRITICAL: Tell ripgrep to search current directory explicitly
  ];

  return new Promise<SearchMatch[]>((resolve, reject) => {
    const matches: SearchMatch[] = [];
    // Ignore stdin so ripgrep doesn't wait for it.
    const rg = spawn("rg", args, {
      cwd: workingDir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let bytes = 0;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      rg.kill("SIGKILL");
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };

    rg.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) stop();
    });
    const lines = createInterface({ input: rg.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (stopped || !line) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type !== "match") return;
        matches.push(parsed);
        if (matches.length >= maxResults) stop();
      } catch {
        // A line cut off at the output cap.
      }
    });

    rg.on("error", (error: NodeJS.ErrnoException) => {
      done();
      // ENOENT = command not found
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "ripgrep (rg) not found. Install with: brew install ripgrep"
          )
        );
        return;
      }
      console.error("Error in searchCode:", error);
      resolve([]);
    });
    // "close": stdout is drained, so every line has been read.
    rg.on("close", (code) => {
      done();
      // What it found before a cap, the timeout or an abort stopped it.
      if (stopped) return resolve(matches);
      // Status 1 = no matches (not an error for ripgrep)
      resolve(code === 0 || code === 1 ? matches : []);
    });
  });
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
