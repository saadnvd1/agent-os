/**
 * The merge gates, ported from dispatch orchestrate. Each one passes, waits
 * (not ready yet: CI running, no review of this commit yet) or fails. Only
 * a failure counts against the task, and the second failure of the same
 * gate goes to Saad instead of being retried.
 */

import { db } from "../db";
import type { ChecksVerdict } from "../tasks/state";
import type { CheckRow } from "./checks";

export type GateName = "ci" | "review" | "blocked" | "scope" | "stack";

export interface GateOutcome {
  gate: GateName;
  state: "pass" | "wait" | "fail";
  reason?: string;
}

export interface GateInput {
  sha: string;
  checks: ChecksVerdict;
  failing?: string | null;
  review: CheckRow | null;
  // A BLOCKED: line, or an approval or question the agent is waiting on.
  blocked: string | null;
  waitingOn: string | null;
  // Plain-rule scope breaks, and the card scope check when the task has one.
  ruleBreaks: string[];
  fromCard: boolean;
  scope: CheckRow | null;
  stackRefusal: string | null;
}

const short = (sha: string) => sha.slice(0, 7);

function ciGate(i: GateInput): GateOutcome {
  const gate = "ci";
  if (i.checks === "pass") return { gate, state: "pass" };
  if (i.checks === "pending")
    return {
      gate,
      state: "wait",
      reason: `CI is still running on ${short(i.sha)}`,
    };
  if (i.checks === "none")
    return {
      gate,
      state: "fail",
      reason: `no CI checks ran on ${short(i.sha)}`,
    };
  return {
    gate,
    state: "fail",
    reason: `CI failed on ${short(i.sha)}${i.failing ? ` (${i.failing})` : ""}`,
  };
}

// A stored check of this exact commit: missing, running or broken waits.
function checkGate(
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
      reason: `the ${what} of ${short(sha)} ${gate === "review" ? "has blocking findings" : "says it's out of scope"}: ${(row.detail ?? "").split("\n").slice(0, 4).join(" ")}`,
    };
  return { gate, state: "pass" };
}

export function evaluateGates(i: GateInput): GateOutcome[] {
  const blocked: GateOutcome =
    i.blocked !== null
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
  return [
    ciGate(i),
    checkGate("review", i.review, i.sha),
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
}

// Counts one failure; returns the count now.
export function recordFailure(
  workspaceId: string,
  sessionId: string,
  gate: string,
  reason: string
): number {
  db.prepare(
    `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, last_reason)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(session_id, gate) DO UPDATE SET count = count + 1, last_reason = excluded.last_reason`
  ).run(sessionId, gate, workspaceId, reason);
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
