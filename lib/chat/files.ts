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

// A folder's index (up to 50,000 paths) is dropped once nobody has typed an
// @mention there for this long.
export const IDLE_MS = 15 * 60_000;

const cache = new Map<
  string,
  { at: number; usedAt: number; files: Promise<IndexedPath[]> }
>();
let sweeper: ReturnType<typeof setInterval> | null = null;

export function sweepFileIndexes(now = Date.now()): void {
  for (const [cwd, hit] of cache)
    if (now - hit.usedAt > IDLE_MS) cache.delete(cwd);
  if (!cache.size && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

export const fileIndexCount = () => cache.size;

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
  const now = Date.now();
  let hit = cache.get(cwd);
  if (!hit || now - hit.at > CACHE_MS) {
    hit = { at: now, usedAt: now, files: listFiles(cwd) };
    cache.set(cwd, hit);
  }
  hit.usedAt = now;
  if (!sweeper) {
    sweeper = setInterval(() => sweepFileIndexes(), 60_000);
    sweeper.unref?.();
  }
  return rankPaths(query, await hit.files);
}
