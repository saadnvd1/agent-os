// The "Code review" section every task's PR body carries (the task brief
// asks for it, after /do-code-review). Merges refuse a PR without one for
// its head commit. No imports: CI runs this file on its own
// (scripts/check-code-review.ts).

export interface CodeReviewSection {
  // The commit the review covered, as written in the section.
  sha: string | null;
}

// Matched one line at a time, never across lines: the body is written by
// the task, and a regex that backtracks over it would block the server.
const MAX_BODY = 65_536;
const HEADING = /^ {0,3}#{1,4} *code review *:?$/i;
const NEXT_HEADING = /^ {0,3}#{1,4} +\S/;
const REVIEWED =
  /^[>*_ -]*reviewed(?: (?:commit|sha|at))?[*_ ]*:[*_` ]*([0-9a-f]{7,40})\b/i;

// Null when the body has no Code review section.
export function parseCodeReview(
  body: string | null | undefined
): CodeReviewSection | null {
  if (!body) return null;
  const lines = body
    .slice(0, MAX_BODY)
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").trimEnd());
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    if (NEXT_HEADING.test(line)) break;
    const sha = REVIEWED.exec(line)?.[1];
    if (sha) return { sha: sha.toLowerCase() };
  }
  return { sha: null };
}

// A branch AgentOS rebased itself (a stack restack): the head the task
// pushed and reviewed, and the head the restack left.
export interface Restacked {
  from: string | null;
  to: string | null;
}

// Why a PR can't merge on its code review, or null when it can. Fails
// closed: an unread body or an unknown head refuses. A review of the head
// the task pushed still counts after AgentOS restacked it, but only while
// the head is exactly the one the restack left: a push by the task after
// that needs a new review.
export function codeReviewRefusal(
  section: CodeReviewSection | null | undefined,
  head: string | undefined,
  restacked?: Restacked | null
): string | null {
  const fix =
    "the task has to run /do-code-review and put a Code review section naming the reviewed commit in the PR body";
  if (section === undefined) return `the PR body couldn't be read: ${fix}`;
  if (!head) return `the PR's head commit is unknown: ${fix}`;
  if (!section) return `the PR body has no Code review section: ${fix}`;
  if (!section.sha)
    return `the PR's Code review section doesn't name the reviewed commit ("Reviewed: <sha>"): ${fix}`;
  const covers = (sha: string | null | undefined) =>
    !!sha && sha.toLowerCase().startsWith(section.sha!);
  if (covers(head)) return null;
  if (restacked?.to === head && covers(restacked.from)) return null;
  return `the PR's code review covers ${section.sha.slice(0, 7)}, not its head ${head.slice(0, 7)}: ${fix}`;
}
