import type { FileSuggestion } from "./events";

// The @mention being typed: an "@" at the start of a line or after a space,
// then the partial path, right up to the caret. `start` is where the "@"
// sits in the text before the caret.
export function mentionQuery(
  beforeCaret: string
): { query: string; start: number } | null {
  const m = /(^|\s)@("?)([^\s@"]*)$/.exec(beforeCaret);
  if (!m) return null;
  return {
    query: m[3],
    start: m.index + m[1].length,
  };
}

// What goes in the message: "@path", a folder with its trailing slash, and
// a path with spaces quoted, as Claude Code writes them. A space follows, so
// typing carries on.
export function mentionText(file: FileSuggestion): string {
  const path = file.dir ? `${file.path}/` : file.path;
  return /\s/.test(path) ? `@"${path}" ` : `@${path} `;
}

function isSubsequence(q: string, s: string): boolean {
  let at = 0;
  for (let i = 0; i < q.length; i++) {
    at = s.indexOf(q[i], at) + 1;
    if (at === 0) return false;
  }
  return true;
}

// A path prepared once for ranking, so a keystroke only scores.
export interface IndexedPath {
  file: FileSuggestion;
  lower: string;
  name: string;
  depth: number;
  // Modified time in ms, where the index knows it: newer ranks first among
  // equal matches.
  mtime?: number;
}

export function indexPaths(files: FileSuggestion[]): IndexedPath[] {
  return files.map((file) => {
    const lower = file.path.toLowerCase();
    let depth = 0;
    for (let i = 0; i < lower.length; i++) if (lower[i] === "/") depth++;
    return {
      file,
      lower,
      name: lower.slice(lower.lastIndexOf("/") + 1),
      depth,
    };
  });
}

function score(q: string, p: IndexedPath): number {
  if (!q) return 1;
  const { lower, name } = p;
  // Every kind of match below is a subsequence of the path: most paths
  // fail here, cheaply.
  if (!isSubsequence(q, lower)) return 0;
  if (name === q) return 100;
  if (name.startsWith(q)) return 80 - Math.min(name.length - q.length, 30);
  if (lower.startsWith(q)) return 70;
  if (name.includes(q)) return 50;
  if (lower.includes(q)) return 40;
  if (isSubsequence(q, name)) return 25;
  return 10;
}

// Ahead of b: a better score, then the more recently modified, then a
// shallower path, then alphabetical.
export interface Scored {
  s: number;
  p: IndexedPath;
}
export const ahead = (a: Scored, b: Scored) =>
  a.s !== b.s
    ? a.s > b.s
    : (a.p.mtime ?? 0) !== (b.p.mtime ?? 0)
      ? (a.p.mtime ?? 0) > (b.p.mtime ?? 0)
      : a.p.depth !== b.p.depth
        ? a.p.depth < b.p.depth
        : a.p.lower < b.p.lower;

// One pass over an index: the best `limit` matches, best first, how many
// entries were looked at, and (when asked) every entry that matched, so the
// next keystroke of the same query can look at those alone: whatever
// matches "fil" also matches "file". `boost` raises every score of a folder
// that should win ties, not for an empty query where recency is the point.
export function scanPaths(
  query: string,
  indexed: IndexedPath[],
  opts: { limit?: number; keep?: boolean; boost?: number } = {}
): { top: Scored[]; matches: IndexedPath[] | null; scanned: number } {
  const limit = opts.limit ?? 15;
  const boost = query ? (opts.boost ?? 0) : 0;
  const top: Scored[] = [];
  const matches: IndexedPath[] | null = opts.keep ? [] : null;
  for (const p of indexed) {
    const raw = score(query, p);
    if (raw === 0) continue;
    matches?.push(p);
    const x = { s: raw + boost, p };
    if (top.length === limit && !ahead(x, top[top.length - 1])) continue;
    let i = top.length;
    while (i > 0 && ahead(x, top[i - 1])) i--;
    top.splice(i, 0, x);
    if (top.length > limit) top.pop();
  }
  return { top, matches, scanned: indexed.length };
}

// Best matches first, then shorter paths; for when the agent can't be asked.
// Keeps only the top few as it goes: a folder can hold tens of thousands of
// files, and this runs on the server's thread at every keystroke.
export function rankPaths(
  query: string,
  files: FileSuggestion[] | IndexedPath[],
  limit = 15
): FileSuggestion[] {
  const indexed =
    files.length && "lower" in files[0]
      ? (files as IndexedPath[])
      : indexPaths(files as FileSuggestion[]);
  return scanPaths(query.toLowerCase(), indexed, { limit }).top.map(
    (x) => x.p.file
  );
}

// How a suggestion reads in the "@" menu: its name, and where it lives. An
// orchestrator's results lead the hint with their source ("HQ · docs").
export function mentionOption(f: FileSuggestion): {
  label: string;
  hint?: string;
} {
  const label = `${f.path.slice(f.path.lastIndexOf("/") + 1)}${f.dir ? "/" : ""}`;
  if (f.source === undefined)
    return {
      label,
      hint: f.path.includes("/")
        ? f.path.slice(0, f.path.lastIndexOf("/"))
        : undefined,
    };
  const rel = f.rel ?? "";
  const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  return { label, hint: parent ? `${f.source} · ${parent}` : f.source };
}

// Every folder a file list implies, alongside the files themselves.
export function withFolders(paths: string[]): FileSuggestion[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++)
      dirs.add(parts.slice(0, i).join("/"));
  }
  return [
    ...[...dirs].map((path) => ({ path, dir: true })),
    ...paths.map((path) => ({ path, dir: false })),
  ];
}
