import { execFile } from "child_process";
import { promisify } from "util";
import type { FileSuggestion } from "./events";
import {
  indexPaths,
  rankPaths,
  withFolders,
  type IndexedPath,
} from "./mentions";

const execFileAsync = promisify(execFile);
const CACHE_MS = 30_000;
const MAX_FILES = 50_000;

const cache = new Map<string, { at: number; files: Promise<IndexedPath[]> }>();

// Ways to list a folder's files with ignored ones left out: ripgrep, or
// git where ripgrep isn't installed.
export const LISTERS: [string, string[]][] = [
  ["rg", ["--files", "--hidden", "-g", "!.git"]],
  ["git", ["ls-files", "--cached", "--others", "--exclude-standard"]],
];

// The folder's files, for @mentions when no agent is running to match them
// itself. Empty when neither tool can list it.
export async function listFiles(
  cwd: string,
  listers = LISTERS
): Promise<IndexedPath[]> {
  for (const [cmd, args] of listers) {
    try {
      const { stdout } = await execFileAsync(cmd, args, {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 5000,
      });
      return indexPaths(
        withFolders(stdout.split("\n").filter(Boolean).slice(0, MAX_FILES))
      );
    } catch {
      // Not installed, or not a repository: try the next.
    }
  }
  return [];
}

export async function fallbackFileSuggestions(
  cwd: string,
  query: string
): Promise<FileSuggestion[]> {
  let hit = cache.get(cwd);
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    hit = { at: Date.now(), files: listFiles(cwd) };
    cache.set(cwd, hit);
  }
  return rankPaths(query, await hit.files);
}
