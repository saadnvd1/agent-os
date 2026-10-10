// The "Code review" section every task's PR body carries (the task brief
// asks for it, after /do-code-review). Merges refuse a PR without one for
// its head commit. No imports: CI runs this file on its own
// (scripts/check-code-review.ts).

export interface CodeReviewSection {
  // The commit the review covered, as written in the section.
  sha: string | null;
  // What kind of AI attribution the body carries, when it does: a fixed
  // label, never the body's own text, which goes into gate messages.
  attribution?: AttributionKind;
}

// Matched one line at a time, never across lines: the body is written by
// the task, and a regex that backtracks over it would block the server.
// Only what renders counts: fenced code and HTML comments are skipped, so an
// example of the section isn't read as the section.
const MAX_BODY = 65_536;
const HEADING = /^ {0,3}(#{1,6}) *code review *:?$/i;
const ANY_HEADING = /^ {0,3}(#{1,6}) +\S/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// AI attribution ("Co-Authored-By: Claude", "Generated with [Claude Code]").
// The same rule as the commit-msg hook's ATTRIBUTION_ERE in
// lib/worktree-hooks.ts; a test keeps the two agreeing.
// Tested on the line with its indent trimmed, so nothing here backtracks
// over leading whitespace.
export const ATTRIBUTION =
  /^(?:co-authored-by:.*(?:claude|anthropic)|claude-session:|🤖 generated with)|generated (?:with|by) \[?claude code/i;
export type AttributionKind =
  | "a Co-Authored-By trailer naming Claude"
  | "a Claude-Session link"
  | 'a "Generated with Claude Code" line';
function attributionKind(line: string): AttributionKind | undefined {
  if (!ATTRIBUTION.test(line)) return;
  if (/^co-authored-by:/i.test(line))
    return "a Co-Authored-By trailer naming Claude";
  if (/^claude-session:/i.test(line)) return "a Claude-Session link";
  return 'a "Generated with Claude Code" line';
}
const REVIEWED =
  /^[>*_ -]*reviewed(?: (?:commit|sha|at))?[*_ ]*:[*_` ]*([0-9a-f]{12,40})\b/i;

function renderedLines(body: string): string[] {
  let text = body.slice(0, MAX_BODY);
  for (let at = text.indexOf("<!--"); at >= 0; at = text.indexOf("<!--", at)) {
    const end = text.indexOf("-->", at + 4);
    text = text.slice(0, at) + (end < 0 ? "" : text.slice(end + 3));
  }
  const lines: string[] = [];
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\t/g, " ").trimEnd();
    const mark = FENCE.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length)
        fence = null;
    } else if (mark) fence = mark;
    else lines.push(line);
  }
  return lines;
}

// The last Code review section that names a commit (or the last one, when
// none does); null when the body has none. A section runs to the next
// heading of its level or higher, so its own subheadings stay inside it.
export function parseCodeReview(
  body: string | null | undefined
): CodeReviewSection | null {
  if (!body) return null;
  const sections: CodeReviewSection[] = [];
  let level = 0;
  let attribution: AttributionKind | undefined;
  for (const line of renderedLines(body)) {
    attribution ??= attributionKind(line.trimStart());
    const heading = HEADING.exec(line);
    if (heading) {
      level = heading[1].length;
      sections.push({ sha: null });
      continue;
    }
    const other = ANY_HEADING.exec(line);
    if (other && other[1].length <= level) level = 0;
    const current = sections.at(-1);
    if (!level || !current || current.sha) continue;
    const sha = REVIEWED.exec(line)?.[1];
    if (sha) current.sha = sha.toLowerCase();
  }
  const found = sections.findLast((s) => s.sha) ?? sections.at(-1) ?? null;
  return found && attribution ? { ...found, attribution } : found;
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
  if (section.attribution)
    return `the PR body carries AI attribution (${section.attribution}): remove it with \`gh pr edit --body-file\``;
  if (!section.sha)
    return `the PR's Code review section doesn't name the reviewed commit ("Reviewed: <sha>"): ${fix}`;
  const covers = (sha: string | null | undefined) =>
    !!sha && sha.toLowerCase().startsWith(section.sha!);
  if (covers(head)) return null;
  if (restacked?.to === head && covers(restacked.from)) return null;
  return `the PR's code review covers ${section.sha.slice(0, 7)}, not its head ${head.slice(0, 7)}: ${fix}`;
}
