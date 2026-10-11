/**
 * The away sweep's choices, made by code from what the server already knows
 * (session facts, git status, stored review verdicts), never by a model
 * reading the workspace. Pure: ./run gathers the inputs and acts.
 *
 * - A task with no activity for STALL_MS and nothing to wait on is nudged,
 *   at most MAX_NUDGES times a period, and again only after it moved.
 * - A task idle with uncommitted work and no PR is asked to commit and open
 *   one, or say why not.
 * - A PR whose CI settled green with no review of its head, or one that was
 *   lost (errored, or cut off and stale), has its review run again, once
 *   the sweep has seen it that way twice, so the orchestrator had its turn.
 * - An interactive session is Saad's: one with uncommitted work is asked to
 *   wrap up, once a period, and nothing more.
 */

import { isFinished } from "../tasks/state";
import type { SessionFacts } from "../orchestrator/facts";

export const SWEEP_EVERY_MS = 10 * 60 * 1000;
export const STALL_MS = 30 * 60 * 1000;
export const IDLE_DIRTY_MS = 15 * 60 * 1000;
export const MAX_NUDGES = 2;
// A review "running" this long was cut off (as clearStaleRunning has it).
export const STALE_REVIEW_MS = 30 * 60 * 1000;

export type CandidateKind = "nudge" | "commit" | "review" | "wrapup";

export interface Candidate {
  kind: CandidateKind;
  sessionId: string;
  // Acted on once per Away period.
  key: string;
  // What the session is told (none for a review).
  message?: string;
  // One line for the decision log.
  log: string;
}

export interface ReviewSeen {
  status: "running" | "pass" | "block" | "error";
  at: number;
}

export interface SweepView {
  now: number;
  facts: SessionFacts[];
  // Sessions with uncommitted changes in their worktree.
  dirty: ReadonlySet<string>;
  // The stored review verdict of a session's commit, if any.
  reviewOf: (sessionId: string, sha: string) => ReviewSeen | null;
  // Tasks that are Saad's now: escalated, or an open ask on them.
  held: ReadonlySet<string>;
  // Keys acted on (or seen, for reviews) this period.
  acted: ReadonlySet<string>;
  // Nudges sent to each session this period.
  nudges: ReadonlyMap<string, number>;
}

const minutes = (ms: number) => Math.floor(ms / 60000);

const BLOCKED_HINT =
  "If only Saad can unblock it, end with a line starting BLOCKED: that says what you need.";

// Live work with an agent to answer: not finished, not a linked machine's
// copy, not setting up, not waiting on someone already.
function workable(f: SessionFacts): boolean {
  // A quick change has no agent; the orchestrator carries it on.
  if (f.quick) return false;
  if (f.status === "dead" || f.status === "waiting" || f.needsInput)
    return false;
  if (f.activity === "setting up") return false;
  if (
    f.task &&
    (isFinished(f.task.state) ||
      f.task.state === "moving" ||
      f.task.state === "exited" ||
      f.task.blocked !== null)
  )
    return false;
  return true;
}

// Sessions worth a `git status`: quiet long enough that uncommitted work
// would matter, and not already asked about it this period. Keeps the
// sweep from reading every worktree.
export function needsGitCheck(
  facts: SessionFacts[],
  now: number,
  acted: ReadonlySet<string>
): string[] {
  return facts
    .filter(
      (f) =>
        workable(f) &&
        f.status === "idle" &&
        !f.task?.pr &&
        now - f.lastActive >= IDLE_DIRTY_MS &&
        !acted.has(f.task ? commitKey(f) : wrapupKey(f))
    )
    .map((f) => f.id);
}

const commitKey = (f: SessionFacts) => `commit:${f.id}:${f.lastActive}`;
const wrapupKey = (f: SessionFacts) => `wrapup:${f.id}`;
export const seenKey = (id: string, sha: string) => `review-seen:${id}:${sha}`;

function taskCandidate(f: SessionFacts, v: SweepView): Candidate | null {
  const task = f.task!;
  const pr = task.pr;
  const quiet = v.now - f.lastActive;
  const who = `task ${f.name}`;

  if (!pr && f.status === "idle" && v.dirty.has(f.id)) {
    const key = commitKey(f);
    if (v.acted.has(key)) return null;
    return {
      kind: "commit",
      sessionId: f.id,
      key,
      message: `Saad is away. You've been idle ${minutes(quiet)} minutes with uncommitted work and no pull request. Commit it and open a pull request, as your task says. If it shouldn't be one, end with a line starting BLOCKED: that says why not.`,
      log: `${who}: idle ${minutes(quiet)}m with uncommitted work and no PR; asked it to commit and open one, or say why not.`,
    };
  }

  const ciFailing = pr?.state === "OPEN" && pr.checks === "fail";
  if ((!pr || ciFailing) && quiet >= STALL_MS) {
    if ((v.nudges.get(f.id) ?? 0) >= MAX_NUDGES) return null;
    const key = `nudge:${f.id}:${f.lastActive}`;
    if (v.acted.has(key)) return null;
    const what = ciFailing
      ? `CI is failing on PR #${pr!.number}. Fix it and push.`
      : "Carry the task on to a pull request.";
    return {
      kind: "nudge",
      sessionId: f.id,
      key,
      message: `Saad is away, and AgentOS hasn't seen activity from you in ${minutes(quiet)} minutes. ${what} ${BLOCKED_HINT}`,
      log: `${who}: no activity for ${minutes(quiet)}m${ciFailing ? ` with CI failing on PR #${pr!.number}` : ", no PR"}; nudged it.`,
    };
  }
  return null;
}

function reviewCandidate(f: SessionFacts, v: SweepView): Candidate | null {
  const pr = f.task?.pr;
  if (
    !f.task ||
    isFinished(f.task.state) ||
    pr?.state !== "OPEN" ||
    !pr.head ||
    pr.checks !== "pass" ||
    (f.task.ciSettleIn ?? 0) > 0 ||
    v.held.has(f.id)
  )
    return null;
  const seen = v.reviewOf(f.id, pr.head);
  const lost =
    !seen ||
    seen.status === "error" ||
    (seen.status === "running" && v.now - seen.at >= STALE_REVIEW_MS);
  if (!lost) return null;
  const key = `review:${f.id}:${pr.head}`;
  if (v.acted.has(key)) return null;
  const why = !seen
    ? "never started"
    : seen.status === "error"
      ? "lost (it errored)"
      : "lost (cut off)";
  return {
    kind: "review",
    sessionId: f.id,
    key,
    log: `task ${f.name}: the review of PR #${pr.number} at ${pr.head.slice(0, 7)} was ${why}; ran it again.`,
  };
}

function wrapupCandidate(f: SessionFacts, v: SweepView): Candidate | null {
  if (f.status !== "idle" || !v.dirty.has(f.id)) return null;
  const key = wrapupKey(f);
  if (v.acted.has(key)) return null;
  return {
    kind: "wrapup",
    sessionId: f.id,
    key,
    message:
      "Saad is away. This session has uncommitted work. Wrap up: on a feature branch, commit what you have with a clear message; on the default branch, leave it uncommitted. Then stop and don't start anything new; Saad picks this up when he's back.",
    log: `${f.name}: Saad's own session, idle with uncommitted work; asked it to wrap up.`,
  };
}

// What to act on now. A review candidate seen for the first time is
// returned with kind "review" only once its seen-key is in `acted`; the
// caller records the seen-key otherwise (see `firstSeen`).
export function pickCandidates(v: SweepView): {
  act: Candidate[];
  firstSeen: string[];
} {
  const act: Candidate[] = [];
  const firstSeen: string[] = [];
  for (const f of v.facts) {
    if (f.task) {
      const review = reviewCandidate(f, v);
      if (review) {
        const seen = seenKey(f.id, f.task.pr!.head!);
        if (v.acted.has(seen)) act.push(review);
        else firstSeen.push(seen);
      }
      if (!workable(f) || v.held.has(f.id)) continue;
      const c = taskCandidate(f, v);
      if (c) act.push(c);
    } else if (workable(f)) {
      const c = wrapupCandidate(f, v);
      if (c) act.push(c);
    }
  }
  return { act, firstSeen };
}
