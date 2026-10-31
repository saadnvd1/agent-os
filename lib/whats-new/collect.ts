import { areaOf, isHiddenScope, VISIBLE_TYPES } from "./areas";

export interface Commit {
  sha: string;
  /** The merge's day in its committer's own timezone, so "today" matches theirs. */
  date: string;
  type: string;
  scope: string | null;
  /** The subject without its type, scope or PR number. */
  title: string;
  pr: number;
}

export type Git = (args: string[]) => string;

const SUBJECT = /^([a-z]+)(?:\(([^)]*)\))?!?: (.+?) \(#(\d+)\)$/;
const SEP = "\x1f";

export function parseCommit(line: string): Commit | null {
  const [sha, iso, subject] = line.split(SEP);
  const m = subject && SUBJECT.exec(subject.trim());
  const time = Date.parse(iso ?? "");
  if (!sha || !m || Number.isNaN(time)) return null;
  return {
    sha,
    date: iso.slice(0, 10),
    type: m[1],
    scope: m[2] || null,
    title: m[3],
    pr: Number(m[4]),
  };
}

/**
 * Merges that could be shown: squash commits with a PR number, of a visible
 * type and scope, not yet in the file. Commits that touch only the changelog
 * file are left out in git, so the generator's own commit is never an input.
 */
export function collectCommits(
  git: Git,
  range: { through?: string | null; sinceDays: number },
  known: Set<number>,
  file: string
): Commit[] {
  const args = [
    "log",
    "--first-parent",
    `--format=%H${SEP}%cI${SEP}%s`,
    ...(range.through
      ? [`${range.through}..HEAD`]
      : [`--since=${range.sinceDays}.days`, "HEAD"]),
    "--",
    ".",
    `:(exclude)${file}`,
  ];
  const seen = new Set<number>();
  const out: Commit[] = [];
  for (const line of git(args).split("\n")) {
    const c = parseCommit(line);
    if (!c || known.has(c.pr) || seen.has(c.pr)) continue;
    if (!VISIBLE_TYPES.includes(c.type) || isHiddenScope(c.scope)) continue;
    seen.add(c.pr);
    out.push(c);
  }
  return out.reverse();
}

export const areaFor = (c: Commit) => areaOf(c.scope);
