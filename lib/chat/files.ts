import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { git } from "../git-exec";
import { isSecretPath } from "../secret-paths";
import type { FileSuggestion } from "./events";
import {
  ahead,
  indexPaths,
  rankPaths,
  scanPaths,
  withFolders,
  type IndexedPath,
  type Scored,
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
  for (const [key, hit] of roots)
    if (now - hit.usedAt > IDLE_MS) roots.delete(key);
  for (const [key, hit] of narrowing)
    if (now - hit.at > NARROW_MS) narrowing.delete(key);
  if (!cache.size && !roots.size && !narrowing.size && sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

export const fileIndexCount = () => cache.size + roots.size;

function keepSweeping() {
  if (sweeper) return;
  sweeper = setInterval(() => sweepFileIndexes(), 60_000);
  sweeper.unref?.();
}

const LIST_TIMEOUT_MS = 5000;

export interface Lister {
  // The program it needs.
  cmd: string;
  list: (cwd: string) => Promise<string>;
  // The same, newest first, where the program can.
  recent?: (cwd: string) => Promise<string>;
}

const rgFiles = async (cwd: string, extra: string[]) =>
  (
    await execFileAsync(
      "rg",
      ["--files", "--hidden", "-g", "!.git", ...extra],
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: LIST_TIMEOUT_MS }
    )
  ).stdout;

// Ways to list a folder's files with ignored ones left out: ripgrep, or
// git where ripgrep isn't installed.
export const LISTERS: Lister[] = [
  {
    cmd: "rg",
    list: (cwd) => rgFiles(cwd, []),
    recent: (cwd) => rgFiles(cwd, ["--sortr", "modified"]),
  },
  {
    cmd: "git",
    list: (cwd) =>
      git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"], {
        timeout: LIST_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      }),
  },
];

// How many of the newest files get their modified time read: enough for a
// "what did I just touch" list, few enough to cost milliseconds.
const RECENT_STATS = 200;

// The folder's files, for @mentions when no agent is running to match them
// itself. Empty when neither tool can list it. Secret files (env files, keys)
// are left out. With `recent`, the newest files carry their modified time.
export async function listFiles(
  cwd: string,
  listers = LISTERS,
  recent = false
): Promise<IndexedPath[]> {
  for (const lister of listers) {
    const newestFirst = recent && lister.recent;
    try {
      const stdout = await (newestFirst ? lister.recent! : lister.list)(cwd);
      const paths = stdout
        .split("\n")
        .filter((p) => p && !isSecretPath(p))
        .slice(0, MAX_FILES);
      const indexed = indexPaths(withFolders(paths));
      if (newestFirst)
        stamp(indexed, await modifiedTimes(cwd, paths.slice(0, RECENT_STATS)));
      return indexed;
    } catch {
      // Not installed, or not a repository: try the next.
    }
  }
  return [];
}

// Modified times of these files, and of the folders above them (the newest
// thing inside).
async function modifiedTimes(
  cwd: string,
  paths: string[]
): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  await Promise.all(
    paths.map(async (p) => {
      let mtime: number;
      try {
        mtime = (await fs.promises.stat(path.join(cwd, p))).mtimeMs;
      } catch {
        return;
      }
      times.set(p, mtime);
      for (let i = p.lastIndexOf("/"); i > 0; i = p.lastIndexOf("/", i - 1)) {
        const dir = p.slice(0, i);
        if ((times.get(dir) ?? 0) < mtime) times.set(dir, mtime);
      }
    })
  );
  return times;
}

function stamp(indexed: IndexedPath[], times: Map<string, number>) {
  for (const p of indexed) {
    const mtime = times.get(p.file.path);
    if (mtime !== undefined) p.mtime = mtime;
  }
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
  keepSweeping();
  return rankPaths(query, await hit.files);
}

// ---- An orchestrator's "@": HQ and the project repositories ----

// An orchestrator works through tools, not in a folder, so its picker
// searches the places the workspace lives in instead.
export interface MentionRoot {
  dir: string;
  // "HQ", a project's name: what the menu shows beside the path.
  label: string;
  // HQ wins ties with the repositories.
  hq: boolean;
}

const ROOT_TTL_MS = 60_000;
// A cold "@" answers from the folders listed by now rather than wait for
// the slowest repository.
const READY_MS = 120;
const HQ_BOOST = 5;
// A query's matches are kept this long for the next keystroke to narrow.
const NARROW_MS = 30_000;

interface RootEntry {
  at: number;
  usedAt: number;
  // The last finished listing, answered from while the next is built.
  list: IndexedPath[] | null;
  building: Promise<IndexedPath[]> | null;
}
const roots = new Map<string, RootEntry>();

// The roots' files as the menu shows them: absolute paths with their
// source, each root's own folder first, so "@agent" finds the repository.
async function buildRoot(root: MentionRoot): Promise<IndexedPath[]> {
  const listed = await listFiles(root.dir, LISTERS, true);
  const self: IndexedPath = {
    file: { path: root.dir, dir: true, source: root.label, rel: "" },
    lower: root.label.toLowerCase(),
    name: root.label.toLowerCase(),
    depth: 0,
  };
  return [
    self,
    ...listed.map((p) => ({
      ...p,
      file: {
        path: path.join(root.dir, p.file.path),
        dir: p.file.dir,
        source: root.label,
        rel: p.file.path,
      },
    })),
  ];
}

function rootEntry(root: MentionRoot): RootEntry {
  const key = `${root.label}\0${root.dir}`;
  const now = Date.now();
  let hit = roots.get(key);
  if (!hit) {
    hit = { at: now, usedAt: now, list: null, building: null };
    roots.set(key, hit);
  }
  hit.usedAt = now;
  if (!hit.building && (!hit.list || now - hit.at > ROOT_TTL_MS)) {
    const entry = hit;
    entry.building = buildRoot(root)
      .catch(() => [] as IndexedPath[])
      .then((list) => {
        entry.list = list;
        entry.at = Date.now();
        entry.building = null;
        return list;
      });
  }
  keepSweeping();
  return hit;
}

// Starts listing the roots, so the first "@" finds them built.
export function warmFileIndexes(rootList: MentionRoot[]): void {
  for (const root of rootList) rootEntry(root);
}

// What the last query kept per root, for the next to narrow.
const narrowing = new Map<
  string,
  { query: string; at: number; kept: Map<IndexedPath[], IndexedPath[]> }
>();

export async function multiRootFileSuggestions(
  rootList: MentionRoot[],
  query: string,
  // Whose keystrokes these are: what one query matched narrows the next.
  key = "",
  stats?: { scanned: number }
): Promise<FileSuggestion[]> {
  const entries = rootList.map(rootEntry);
  const pending = entries.flatMap((e) =>
    e.list || !e.building ? [] : [e.building]
  );
  if (pending.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => (timer = setTimeout(resolve, READY_MS))),
    ]);
    clearTimeout(timer);
  }

  const q = query.toLowerCase();
  const prev = key ? narrowing.get(key) : undefined;
  const narrower = !!prev && prev.query !== "" && q.startsWith(prev.query);
  const kept = new Map<IndexedPath[], IndexedPath[]>();
  const tops: Scored[] = [];
  entries.forEach((entry, i) => {
    const list = entry.list;
    if (!list) return;
    const from = (narrower && prev!.kept.get(list)) || list;
    const scan = scanPaths(q, from, {
      keep: q !== "",
      boost: rootList[i].hq ? HQ_BOOST : 0,
    });
    if (stats) stats.scanned += scan.scanned;
    if (scan.matches) kept.set(list, scan.matches);
    tops.push(...scan.top);
  });
  if (key && q) narrowing.set(key, { query: q, at: Date.now(), kept });
  else if (key) narrowing.delete(key);
  keepSweeping();
  return tops
    .sort((a, b) => (ahead(a, b) ? -1 : ahead(b, a) ? 1 : 0))
    .slice(0, 15)
    .map((x) => x.p.file);
}
