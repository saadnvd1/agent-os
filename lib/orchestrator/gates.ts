/**
 * The merge gates, ported from dispatch orchestrate. Each one passes, waits
 * (not ready yet: CI running or settling, no review of this commit yet),
 * fails, or goes straight to Saad (no CI at all). Only a failure counts
 * against the task, and the second failure of the same gate goes to Saad
 * instead of being retried. The count is per task and gate: a review that
 * blocks counts when its verdict arrives, whether or not sign_off ever
 * reads it, and reading the same commit's verdict again isn't another.
 */

import { db } from "../db";
import type { ChecksVerdict } from "../tasks/state";
import type { CheckRow } from "./checks";
import { APPROVAL_GATES, mergeApprovalsOn } from "./merge-approvals";
import { untrusted } from "./untrusted";

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
  // Seconds until CI on this commit counts as settled (tasks/task-state).
  settleIn: number;
  review: CheckRow | null;
  // A BLOCKED: line, or an approval or question the agent is waiting on.
  blocked: string | null;
  waitingOn: string | null;
  // Plain-rule scope breaks, and the card scope check when the task has one.
  ruleBreaks: string[];
  fromCard: boolean;
  scope: CheckRow | null;
  stackRefusal: string | null;
  // Why the PR body's Code review section doesn't cover this commit.
  codeReviewRefusal: string | null;
  // Why it isn't covered yet but will be (an external PR whose own review
  // of this commit stands in for the section).
  codeReviewWait?: string | null;
  // A PR no task owns has no session to read: a draft isn't ready yet, and
  // a label saying it's blocked holds it.
  prDraft?: string | null;
  prBlocked?: string | null;
}

const short = (sha: string) => sha.slice(0, 7);

function ciGate(i: GateInput): GateOutcome {
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
  if (i.settleIn > 0)
    return {
      gate,
      state: "wait",
      reason:
        i.checks === "none"
          ? `no CI checks have registered on ${at} yet (looking again in ${i.settleIn}s)`
          : `CI is green on ${at} but settling: ${i.settleIn}s more with no new check`,
    };
  if (i.checks === "none")
    return {
      gate,
      state: "escalate",
      reason: `no CI ran on ${at}: this repository has no checks to gate a merge on`,
    };
  return { gate, state: "pass" };
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
  const codeReview: GateOutcome = i.codeReviewRefusal
    ? { gate: "code-review", state: "fail", reason: i.codeReviewRefusal }
    : i.codeReviewWait
      ? { gate: "code-review", state: "wait", reason: i.codeReviewWait }
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
}

// The gates whose failure is a verdict stored against one commit: the same
// verdict read again is the same failure.
export const PER_COMMIT_GATES: readonly string[] = ["review", "scope"];

// Counts one failure; returns the count now. With `sha`, a failure of the
// commit last counted for this gate isn't counted again.
export function recordFailure(
  workspaceId: string,
  sessionId: string,
  gate: string,
  reason: string,
  sha: string | null = null
): number {
  db.prepare(
    `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, last_reason, last_sha)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(session_id, gate) DO UPDATE SET
       count = count + CASE WHEN excluded.last_sha IS NOT NULL AND last_sha IS excluded.last_sha THEN 0 ELSE 1 END,
       last_reason = excluded.last_reason,
       last_sha = excluded.last_sha`
  ).run(sessionId, gate, workspaceId, reason, sha);
  return failureOf(sessionId, gate)!.count;
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

export function markEscalated(sessionId: string, gate: string): void {
  db.prepare(
    `UPDATE orchestrator_gate_failures SET escalated_at = datetime('now') WHERE session_id = ? AND gate = ?`
  ).run(sessionId, gate);
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
