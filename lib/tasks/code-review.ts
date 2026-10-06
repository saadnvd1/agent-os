// The "Code review" section every task's PR body carries (the task brief
// asks for it, after /do-code-review). Merges refuse a PR without one for
// its head commit. No imports: CI runs this file on its own
// (scripts/check-code-review.ts).

export interface CodeReviewSection {
  // The commit the review covered, as written in the section.
  sha: string | null;
}

const HEADING = /^[ \t]{0,3}#{1,4}[ \t]*code review[ \t]*:?[ \t]*$/im;
const NEXT_HEADING = /^[ \t]{0,3}#{1,4}[ \t]+\S/m;
const REVIEWED =
  /^[\s>*_-]*reviewed(?:[ \t]+(?:commit|sha|at))?[\s*_]*:[\s*_`]*([0-9a-f]{7,40})\b/im;

// Null when the body has no Code review section.
export function parseCodeReview(
  body: string | null | undefined
): CodeReviewSection | null {
  if (!body) return null;
  const heading = HEADING.exec(body);
  if (!heading) return null;
  const rest = body.slice(heading.index + heading[0].length);
  const end = NEXT_HEADING.exec(rest);
  const section = end ? rest.slice(0, end.index) : rest;
  return { sha: REVIEWED.exec(section)?.[1]?.toLowerCase() ?? null };
}

// Why a PR can't merge on its code review, or null when it can. Fails
// closed: an unread body or an unknown head refuses. `restacked` accepts a
// review of an earlier commit, for a land where AgentOS rebased the branch
// itself and the orchestrator's own review re-checks the new head.
export function codeReviewRefusal(
  section: CodeReviewSection | null | undefined,
  head: string | undefined,
  opts: { restacked?: boolean } = {}
): string | null {
  const fix =
    "the task has to run /do-code-review and put a Code review section naming the reviewed commit in the PR body";
  if (section === undefined) return `the PR body couldn't be read: ${fix}`;
  if (!head) return `the PR's head commit is unknown: ${fix}`;
  if (!section) return `the PR body has no Code review section: ${fix}`;
  if (!section.sha)
    return `the PR's Code review section doesn't name the reviewed commit ("Reviewed: <sha>"): ${fix}`;
  if (head.toLowerCase().startsWith(section.sha) || opts.restacked) return null;
  return `the PR's code review covers ${section.sha.slice(0, 7)}, not its head ${head.slice(0, 7)}: ${fix}`;
}
