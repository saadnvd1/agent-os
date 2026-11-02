/**
 * The away sweep's choices, made by code from what the server already knows
 * (session facts, real activity, git status, stored review verdicts), never
 * by a model reading the workspace. Pure: ./run gathers the inputs and acts.
 *
 * The sweep messages no session. What it finds goes to the workspace's
 * orchestrator as one digest, which decides what needs doing:
 * - a task with no real activity for STALL_MS and nothing to wait on;
 * - a task idle with uncommitted work and no PR;
 * - an interactive session (Saad's) idle with uncommitted work, whose
 *   agent is still up: the orchestrator may ask it once to wrap up.
 * Only sessions with a real turn inside the window are listed; older ones
 * are left alone. Each is listed once per state (per period, for an
 * interactive one).
 *
 * A PR whose CI settled green with no review of its head, or one that was
 * lost (errored, or cut off and stale), has its review run again, once the
 * sweep has seen it that way twice, so the orchestrator had its turn. That
 * runs a reviewer, not the session, so it isn't held to the window.
 */

import { isFinished } from "../tasks/state";
import type { SessionFacts } from "../orchestrator/facts";
import { owner } from "../owner";

export const SWEEP_EVERY_MS = 10 * 60 * 1000;
export const STALL_MS = 30 * 60 * 1000;
export const IDLE_DIRTY_MS = 15 * 60 * 1000;
// A review "running" this long was cut off (as clearStaleRunning has it).
export const STALE_REVIEW_MS = 30 * 60 * 1000;

export type CandidateKind = "stalled" | "commit" | "review" | "wrapup";

export interface Candidate {
  kind: CandidateKind;
  sessionId: string;
  // Listed (or run, for a review) once per Away period.
  key: string;
  // Its line in the orchestrator's digest and the decision log.
  line: string;
}

export interface ReviewSeen {
  status: "running" | "pass" | "block" | "error";
  at: number;
}

export interface SweepView {
  now: number;
  facts: SessionFacts[];
  // Each session's last real turn, in ms (./activity).
  turns: ReadonlyMap<string, number>;
  // Older than this is left alone.
  windowMs: number;
  // Interactive sessions whose agent is up.
  live: ReadonlySet<string>;
  // Sessions with uncommitted changes in their worktree.
  dirty: ReadonlySet<string>;
  // The stored review verdict of a session's commit, if any.
  reviewOf: (sessionId: string, sha: string) => ReviewSeen | null;
  // Tasks that are Saad's now: escalated, or an open ask on them.
  held: ReadonlySet<string>;
  // Keys acted on (or seen, for reviews) this period.
  acted: ReadonlySet<string>;
}

const minutes = (ms: number) => Math.floor(ms / 60000);

const turnOf = (f: SessionFacts, v: Pick<SweepView, "turns">) =>
  v.turns.get(f.id) ?? 0;

// Real activity inside the window: anything older is never listed.
export const recent = (
  f: SessionFacts,
  v: Pick<SweepView, "now" | "turns" | "windowMs">
) => {
  const turn = turnOf(f, v);
  return turn > 0 && v.now - turn <= v.windowMs;
};

// Live work with an agent to answer: not stopped, not finished, not a
// linked machine's copy, not setting up, not waiting on someone already.
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

const commitKey = (f: SessionFacts, turn: number) => `commit:${f.id}:${turn}`;
const wrapupKey = (f: SessionFacts) => `wrapup:${f.id}`;
export const seenKey = (id: string, sha: string) => `review-seen:${id}:${sha}`;

// Who could be listed at all.
function eligible(f: SessionFacts, v: GitView): boolean {
  if (!workable(f) || !recent(f, v)) return false;
  return f.task ? !v.held.has(f.id) : v.live.has(f.id);
}

type GitView = Pick<
  SweepView,
  "facts" | "now" | "turns" | "windowMs" | "live" | "held" | "acted"
>;

// Sessions worth a `git status`: recent, quiet long enough that
// uncommitted work would matter, and not already listed for it. Keeps the
// sweep from reading every worktree.
export function needsGitCheck(v: GitView): string[] {
  return v.facts
    .filter(
      (f) =>
        eligible(f, v) &&
        f.status === "idle" &&
        !f.task?.pr &&
        v.now - turnOf(f, v) >= IDLE_DIRTY_MS &&
        !v.acted.has(f.task ? commitKey(f, turnOf(f, v)) : wrapupKey(f))
    )
    .map((f) => f.id);
}

function taskCandidate(f: SessionFacts, v: SweepView): Candidate | null {
  const pr = f.task!.pr;
  const turn = turnOf(f, v);
  const quiet = v.now - turn;
  const who = `task ${f.name}`;

  if (!pr && f.status === "idle" && v.dirty.has(f.id)) {
    const key = commitKey(f, turn);
    if (v.acted.has(key)) return null;
    return {
      kind: "commit",
      sessionId: f.id,
      key,
      line: `${who} (${f.id}): idle ${minutes(quiet)}m with uncommitted work and no PR.`,
    };
  }

  const ciFailing = pr?.state === "OPEN" && pr.checks === "fail";
  if ((!pr || ciFailing) && quiet >= STALL_MS) {
    const key = `stalled:${f.id}:${turn}`;
    if (v.acted.has(key)) return null;
    return {
      kind: "stalled",
      sessionId: f.id,
      key,
      line: `${who} (${f.id}): no activity for ${minutes(quiet)}m${ciFailing ? `, CI failing on PR #${pr!.number}` : ", no PR yet"}.`,
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
    line: `task ${f.name}: the review of PR #${pr.number} at ${pr.head.slice(0, 7)} was ${why}; AgentOS ran it again.`,
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
    line: `${f.name} (${f.id}): ${owner()}'s own session, idle ${minutes(v.now - turnOf(f, v))}m with uncommitted work.`,
  };
}

// What's new this sweep: lines for the orchestrator's digest, and the
// reviews to run again. A review candidate seen for the first time is
// returned only once its seen-key is in `acted`; the caller records the
// seen-key otherwise (`firstSeen`).
export function pickCandidates(v: SweepView): {
  flags: Candidate[];
  reviews: Candidate[];
  firstSeen: string[];
} {
  const flags: Candidate[] = [];
  const reviews: Candidate[] = [];
  const firstSeen: string[] = [];
  for (const f of v.facts) {
    if (f.task) {
      const review = reviewCandidate(f, v);
      if (review) {
        const seen = seenKey(f.id, f.task.pr!.head!);
        if (v.acted.has(seen)) reviews.push(review);
        else firstSeen.push(seen);
      }
    }
    if (!eligible(f, v)) continue;
    const c = f.task ? taskCandidate(f, v) : wrapupCandidate(f, v);
    if (c) flags.push(c);
  }
  return { flags, reviews, firstSeen };
}
