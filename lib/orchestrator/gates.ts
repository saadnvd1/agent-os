/**
 * The merge gates, ported from dispatch orchestrate. Each one passes, waits
 * (not ready yet: CI running or settling, no review of this commit yet),
 * fails, or goes straight to Saad (the repository has no CI at all, never
 * just a head with no checks). Only a failure counts against the task, once
 * per task, gate and head commit, whichever path judged it (the armed
 * watcher, CI finishing, sign_off, done, land, a review's verdict arriving):
 * judging the same head again is never another failure. Every new head is
 * judged afresh; only a task stuck in a loop goes to Saad (loop-guard.ts).
 */

import { db } from "../db";
import type { CodeReviewGate } from "../tasks/code-review";
import type { ChecksVerdict, TaskPR } from "../tasks/state";
import type { CheckRow } from "./checks";
import { APPROVAL_GATES, mergeApprovalsOn } from "./merge-approvals";
import type { RepoCI } from "./repo-ci";
import { untrusted } from "./untrusted";
import { markStatusDirty } from "../status/dirty";

export type GateName =
  | "ci"
  | "review"
  | "code-review"
  | "blocked"
  | "scope"
  | "stack";

export interface GateOutcome {
  gate: GateName;
  state: "pass" | "wait" | "fail" | "escalate";
  reason?: string;
}

export interface GateInput {
  sha: string;
  checks: ChecksVerdict;
  failing?: string | null;
  // The failing check's details page, for its log (loop-guard.ts).
  failingUrl?: string | null;
  // Seconds until CI on this commit counts as settled (tasks/task-state).
  settleIn: number;
  // GitHub's word on merging the PR into its base, and that base's name.
  mergeable?: TaskPR["mergeable"];
  baseName?: string | null;
  // Whether the repository has CI; only read when the head has no checks.
  repoCI?: RepoCI;
  review: CheckRow | null;
  // A BLOCKED: line, or an approval or question the agent is waiting on.
  blocked: string | null;
  waitingOn: string | null;
  // Plain-rule scope breaks, and the card scope check when the task has one.
  ruleBreaks: string[];
  fromCard: boolean;
  scope: CheckRow | null;
  stackRefusal: string | null;
  // Whether a passing independent review covers this commit, and the body
  // carries no AI attribution (tasks/code-review.ts).
  codeReview: CodeReviewGate;
  // A PR no task owns has no session to read: a draft isn't ready yet, and
  // a label saying it's blocked holds it.
  prDraft?: string | null;
  prBlocked?: string | null;
}

const short = (sha: string) => sha.slice(0, 7);

export function ciGate(
  i: Pick<
    GateInput,
    | "sha"
    | "checks"
    | "failing"
    | "settleIn"
    | "mergeable"
    | "baseName"
    | "repoCI"
  >
): GateOutcome {
  const gate = "ci";
  const at = short(i.sha);
  if (i.checks === "pending")
    return { gate, state: "wait", reason: `CI is still running on ${at}` };
  if (i.checks === "fail")
    return {
      gate,
      state: "fail",
      reason: `CI failed on ${at}${i.failing ? ` (${untrusted("CI", i.failing)})` : ""}`,
    };
  if (i.checks === "none") return noChecks(i, at);
  if (i.settleIn > 0)
    return {
      gate,
      state: "wait",
      reason: `CI is green on ${at} but settling: ${i.settleIn}s more with no new check`,
    };
  return { gate, state: "pass" };
}

// A head with no checks. Only a repository with no CI at all has nothing to
// gate on; in one with CI the head is not yet, whatever the reason.
function noChecks(i: Parameters<typeof ciGate>[0], at: string): GateOutcome {
  const gate = "ci";
  const wait = (reason: string): GateOutcome => ({
    gate,
    state: "wait",
    reason,
  });
  if (i.mergeable === "CONFLICTING")
    return wait(
      `PR conflicts with ${i.baseName ?? "its base"}; CI can't run on ${at} until it's rebased`
    );
  if (i.settleIn > 0)
    return wait(
      `no CI checks have registered on ${at} yet (looking again in ${i.settleIn}s)`
    );
  if (i.repoCI === "no")
    return {
      gate,
      state: "escalate",
      reason: `no CI ran on ${at}: this repository has no checks to gate a merge on (no workflow files, and no check has run on its default branch or recent PRs)`,
    };
  if (i.repoCI === "yes")
    return wait(
      i.mergeable === "UNKNOWN"
        ? `no CI checks on ${at} yet: GitHub is still working out whether it merges cleanly`
        : `no CI checks on ${at} yet: CI hasn't been triggered on this head`
    );
  return wait(
    `no CI checks on ${at}, and whether this repository has CI couldn't be read; looking again`
  );
}

// A stored check of this exact commit: missing, running or broken waits.
export function checkGate(
  gate: "review" | "scope",
  row: CheckRow | null,
  sha: string
): GateOutcome {
  const what = gate === "review" ? "review" : "scope check against the card";
  if (!row || row.sha !== sha)
    return {
      gate,
      state: "wait",
      reason: `no ${what} of ${short(sha)} yet: call review`,
    };
  if (row.status === "running")
    return {
      gate,
      state: "wait",
      reason: `the ${what} of ${short(sha)} is still running`,
    };
  if (row.status === "error")
    return {
      gate,
      state: "wait",
      reason: `the ${what} couldn't run (${row.detail}): call review with fresh`,
    };
  if (row.status === "block")
    return {
      gate,
      state: "fail",
      reason: `the ${what} of ${short(sha)} ${gate === "review" ? "has blocking findings" : "says it's out of scope"}: ${untrusted(gate === "review" ? "reviewer" : "scope check", (row.detail ?? "").split("\n").slice(0, 4).join(" "))}`,
    };
  return { gate, state: "pass" };
}

export function evaluateGates(i: GateInput): GateOutcome[] {
  const blocked: GateOutcome = i.prBlocked
    ? { gate: "blocked", state: "fail", reason: i.prBlocked }
    : i.prDraft
      ? { gate: "blocked", state: "wait", reason: i.prDraft }
      : i.blocked !== null
        ? {
            gate: "blocked",
            state: "fail",
            reason: `the task is BLOCKED: ${i.blocked}`,
          }
        : i.waitingOn
          ? {
              gate: "blocked",
              state: "fail",
              reason: `the task is waiting on an answer: ${i.waitingOn}`,
            }
          : { gate: "blocked", state: "pass" };
  const scope: GateOutcome = i.ruleBreaks.length
    ? { gate: "scope", state: "fail", reason: i.ruleBreaks.join("; ") }
    : i.fromCard
      ? checkGate("scope", i.scope, i.sha)
      : { gate: "scope", state: "pass" };
  const stack: GateOutcome = i.stackRefusal
    ? { gate: "stack", state: "fail", reason: i.stackRefusal }
    : { gate: "stack", state: "pass" };
  // Its wait is the review gate's own (no passing review of this exact
  // head), which already holds the merge: only paths without that gate (an
  // approval, a stack's land) read it.
  const codeReview: GateOutcome = i.codeReview.refusal
    ? { gate: "code-review", state: "fail", reason: i.codeReview.refusal }
    : { gate: "code-review", state: "pass" };
  return [
    ciGate(i),
    checkGate("review", i.review, i.sha),
    codeReview,
    blocked,
    scope,
    stack,
  ];
}

export interface FailureRow {
  session_id: string;
  gate: string;
  workspace_id: string;
  count: number;
  last_reason: string | null;
  escalated_at: string | null;
  last_sha: string | null;
  // Set while the escalation's ask waits for the agent to finish (held-asks.ts).
  ask_held_at: string | null;
  // Commits in a row this gate failed on, since it last passed.
  streak: number;
  last_signature: string | null;
  // 1 when the last failure's signature equals the one before it.
  repeated: number;
  // Why it went to Saad, as his ask says it.
  escalated_why: string | null;
}

// Counts one failure; returns the count now. With `sha`, a failure is
// counted once per commit: the (task, gate, sha) key in
// orchestrator_gate_failure_commits decides, so neither a restart nor two
// evaluations at once count the same head twice. `signature` is what the
// loop guard compares between consecutive failures (loop-guard.ts).
export function recordFailure(
  workspaceId: string,
  sessionId: string,
  gate: string,
  reason: string,
  sha: string | null = null,
  signature: string | null = null
): number {
  return db
    .transaction(countOnce)
    .immediate(workspaceId, sessionId, gate, reason, sha, signature);
}

function countOnce(
  workspaceId: string,
  sessionId: string,
  gate: string,
  reason: string,
  sha: string | null,
  signature: string | null
): number {
  const fresh =
    sha === null ||
    db
      .prepare(
        `INSERT OR IGNORE INTO orchestrator_gate_failure_commits (session_id, gate, sha, workspace_id, reason, signature)
           VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sessionId, gate, sha, workspaceId, reason, signature).changes > 0;
  // Every SET reads the row as it was before this update.
  db.prepare(
    `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, last_reason, last_sha, streak, last_signature, repeated)
       VALUES (@session, @gate, @workspace, 1, @reason, @sha, 1, @signature, 0)
       ON CONFLICT(session_id, gate) DO UPDATE SET
         count = count + @fresh,
         last_reason = excluded.last_reason,
         last_sha = excluded.last_sha,
         streak = streak + @fresh,
         repeated = CASE WHEN @fresh = 1
           THEN (streak > 0 AND excluded.last_signature IS NOT NULL AND last_signature IS excluded.last_signature)
           ELSE repeated END,
         last_signature = CASE WHEN @fresh = 1 THEN excluded.last_signature ELSE last_signature END`
  ).run({
    session: sessionId,
    gate,
    workspace: workspaceId,
    reason,
    sha,
    signature,
    fresh: fresh ? 1 : 0,
  });
  markStatusDirty(sessionId);
  return failureOf(sessionId, gate)!.count;
}

// The gate passed at a head: the next failure starts a new streak. An
// escalated gate keeps its record; Saad has it.
export function recordPass(sessionId: string, gate: string): void {
  db.prepare(
    `UPDATE orchestrator_gate_failures SET streak = 0, last_signature = NULL, repeated = 0
     WHERE session_id = ? AND gate = ? AND escalated_at IS NULL AND streak > 0`
  ).run(sessionId, gate);
}

// Whether this head's failure of the gate is already counted.
export function failureCounted(
  sessionId: string,
  gate: string,
  sha: string
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM orchestrator_gate_failure_commits WHERE session_id = ? AND gate = ? AND sha = ?`
    )
    .get(sessionId, gate, sha);
}

export interface CommitFailure {
  sha: string;
  reason: string | null;
  signature: string | null;
}

// The gate's latest `n` failed commits, oldest first.
export function lastFailures(
  sessionId: string,
  gate: string,
  n: number
): CommitFailure[] {
  return (
    db
      .prepare(
        `SELECT sha, reason, signature FROM orchestrator_gate_failure_commits
         WHERE session_id = ? AND gate = ? ORDER BY rowid DESC LIMIT ?`
      )
      .all(sessionId, gate, n) as CommitFailure[]
  ).reverse();
}

export function failureOf(sessionId: string, gate: string): FailureRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM orchestrator_gate_failures WHERE session_id = ? AND gate = ?`
      )
      .get(sessionId, gate) as FailureRow | undefined) ?? null
  );
}

export function markEscalated(
  sessionId: string,
  gate: string,
  why: string | null = null
): void {
  db.prepare(
    `UPDATE orchestrator_gate_failures SET escalated_at = datetime('now'), escalated_why = ? WHERE session_id = ? AND gate = ?`
  ).run(why, sessionId, gate);
  markStatusDirty(sessionId);
}

export function holdAsk(sessionId: string, gate: string): void {
  db.prepare(
    `UPDATE orchestrator_gate_failures SET ask_held_at = COALESCE(ask_held_at, datetime('now')) WHERE session_id = ? AND gate = ?`
  ).run(sessionId, gate);
}

export function releaseHeldAsks(sessionId: string): void {
  db.prepare(
    `UPDATE orchestrator_gate_failures SET ask_held_at = NULL WHERE session_id = ?`
  ).run(sessionId);
}

export function heldAskFailures(workspaceId: string): FailureRow[] {
  return db
    .prepare(
      `SELECT * FROM orchestrator_gate_failures
       WHERE workspace_id = ? AND escalated_at IS NOT NULL AND ask_held_at IS NOT NULL`
    )
    .all(workspaceId) as FailureRow[];
}

export function escalations(sessionId: string): FailureRow[] {
  return db
    .prepare(
      `SELECT * FROM orchestrator_gate_failures WHERE session_id = ? AND escalated_at IS NOT NULL`
    )
    .all(sessionId) as FailureRow[];
}

// The escalations that still hold the task: one only Saad's approval was
// asked for (sensitive files, size) lets go once that approval is switched
// off, and the task goes through the gates like any other.
export function holdingEscalations(sessionId: string): FailureRow[] {
  const held = escalations(sessionId);
  return mergeApprovalsOn()
    ? held
    : held.filter((h) => !APPROVAL_GATES.includes(h.gate));
}
