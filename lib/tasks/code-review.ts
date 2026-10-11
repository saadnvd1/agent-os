// The code-review gate, the same for every PR: a passing independent
// review (lib/orchestrator/review) of its exact head, and a body with no AI
// attribution. Tasks don't write a review section in the body any more: the
// orchestrator's review is the one review.

// Matched one line at a time, never across lines: the body is written by
// the task, and a regex that backtracks over it would block the server.
// Only what renders counts: fenced code and HTML comments are skipped, so an
// example isn't read as the real thing.
const MAX_BODY = 65_536;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// AI attribution ("Co-Authored-By: Claude", "Generated with [Claude Code]").
// The same rule as the commit-msg hook's ATTRIBUTION_ERE in
// lib/worktree-hooks.ts; a test keeps the two agreeing.
// Tested on the line with its indent trimmed, so nothing here backtracks
// over leading whitespace. "Generated with Claude Code" counts anywhere in a
// line (after HTML, a :robot: shortcode, a list number or a sentence, it
// still renders as a footer) unless a quote or a letter sits right before it:
// prose that quotes the footer ("the 'Generated with Claude Code' footer")
// isn't one.
export const ATTRIBUTION =
  /^(?:co-authored-by:.*(?:claude|anthropic)|claude-session:|🤖 generated with)|(?:^|[^\p{L}\p{N}"'`])generated (?:with|by) \[?claude code/iu;
export type AttributionKind =
  | "a Co-Authored-By trailer naming Claude"
  | "a Claude-Session link"
  | 'a "Generated with" AI footer';
function attributionKind(line: string): AttributionKind | undefined {
  if (!ATTRIBUTION.test(line)) return;
  if (/^co-authored-by:/i.test(line))
    return "a Co-Authored-By trailer naming Claude";
  if (/^claude-session:/i.test(line)) return "a Claude-Session link";
  return 'a "Generated with" AI footer';
}

export function renderedLines(body: string): string[] {
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

// The AI attribution a body carries anywhere.
export function attributionIn(
  body: string | null | undefined
): AttributionKind | undefined {
  if (!body) return;
  for (const line of renderedLines(body)) {
    const kind = attributionKind(line.trimStart());
    if (kind) return kind;
  }
}

// A branch AgentOS rebased itself (a stack restack, or the automatic
// rebase onto its base): the head the task pushed, and the head AgentOS
// left.
export interface Restacked {
  from: string | null;
  to: string | null;
}

export interface ReviewState {
  sha: string;
  status: "running" | "pass" | "block" | "error";
}

export interface CodeReviewGate {
  // Fails the gate: counts against the task.
  refusal: string | null;
  // Not covered yet, but a review will cover it.
  wait: string | null;
  // A review covering the head finished, passing or not. Saad's approval
  // of the commit overrides what it found, never whether one ran.
  ran?: boolean;
}

const short = (sha: string) => sha.slice(0, 7);

// Fails closed: an unread body or an unknown head refuses. A review of the
// head the task pushed still counts after AgentOS restacked or rebased it
// cleanly, but only while the head is exactly the one AgentOS left: a push
// by the task after that needs a new review.
export function codeReviewGate(opts: {
  head: string | undefined;
  // The AI attribution in the PR body (attributionIn): null for none,
  // undefined when the body couldn't be read.
  attribution: AttributionKind | null | undefined;
  review: (sha: string) => ReviewState | null;
  restacked?: Restacked | null;
}): CodeReviewGate {
  const { head, restacked } = opts;
  const no = (refusal: string) => ({ refusal, wait: null });
  const { attribution } = opts;
  if (attribution === undefined) return no("the PR body couldn't be read");
  if (!head) return no("the PR's head commit is unknown");
  if (attribution)
    return no(
      `the PR body carries AI attribution (${attribution}): remove it with \`gh pr edit --body-file\``
    );
  // The reviews that cover the head: its own, and the one of the head the
  // task pushed while the head is the one AgentOS left.
  const covering = [
    opts.review(head),
    restacked?.to === head && restacked.from
      ? opts.review(restacked.from)
      : null,
  ];
  if (covering.some((r) => r?.status === "pass"))
    return { refusal: null, wait: null, ran: true };
  const now = covering[0];
  return {
    refusal: null,
    wait: `no passing independent review of ${short(head)}${now?.status === "running" ? " yet (it's running)" : now?.status === "block" ? " (it has blocking findings)" : ": call review"}`,
    ran: covering.some((r) => r?.status === "block"),
  };
}

// The gate as one reason, for paths that only merge or refuse (a stack
// landing, an approved merge): a wait refuses there too.
export function codeReviewRefusal(
  opts: Parameters<typeof codeReviewGate>[0]
): string | null {
  const gate = codeReviewGate(opts);
  return gate.refusal ?? gate.wait;
}
