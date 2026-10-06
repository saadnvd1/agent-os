/**
 * `sign_off` and `land`: merges only through the gates. Anything touching
 * CI config, deploys or secrets handling goes to Saad whatever the gates
 * say, and a gate failing twice on a task does too. Once a task is with
 * Saad the orchestrator doesn't merge it; he signs it off or drops it.
 */

import type { Session } from "../db";
import { blockedReason } from "../tasks/state";
import { prFor } from "../tasks/session";
import { signOffTask } from "../tasks";
import { signOffRefusal } from "../stacks/guard";
import { getStack, landInBackground } from "../stacks";
import { checkWaitingPatterns, statusDetector } from "../status-detector";
import { getCheck } from "./checks";
import { addedLines, changedFiles, ruleBreaks, sensitiveFiles } from "./diff";
import {
  escalations,
  evaluateGates,
  failureOf,
  markEscalated,
  recordFailure,
  type GateOutcome,
} from "./gates";
import { addNote } from "./notes";
import { fetchRefs, repoOf } from "./review";
import { workspaceStack, workspaceTask } from "./targets";

const short = (sha: string) => sha.slice(0, 7);

// What the agent's terminal shows: a BLOCKED: line, or a prompt waiting
// for an approval or an answer.
async function waitingState(task: Session) {
  await statusDetector.refreshCache();
  if (!statusDetector.sessionExists(task.tmux_name))
    return { blocked: null, waitingOn: null };
  const tail = (await statusDetector.capturePane(task.tmux_name))
    .split("\n")
    .slice(-15)
    .join("\n");
  return {
    blocked: blockedReason(tail),
    waitingOn: checkWaitingPatterns(tail) ? "a prompt in its terminal" : null,
  };
}

function escalate(
  workspaceId: string,
  task: Session,
  gate: string,
  why: string,
  url: string
): string {
  markEscalated(task.id, gate);
  const text = `Saad must decide on ${task.name} (${url}): ${why}. The orchestrator won't merge it; sign it off or drop it yourself.`;
  addNote(workspaceId, text, "escalation");
  return `Escalated to Saad: ${why}. Don't retry; say so in your chat.`;
}

// Why the task can't merge now, or null with the sha that may merge.
// Landing merges a stack bottom-up, so there a parent not merged yet is fine.
async function judge(
  workspaceId: string,
  task: Session,
  landing = false
): Promise<{ refusal: string } | { sha: string; pr: number; url: string }> {
  if (task.task_status !== "running")
    return { refusal: `${task.name} is already ${task.task_status}` };
  const held = escalations(task.id);
  if (held.length)
    return {
      refusal: `${task.name} is with Saad (${held.map((h) => h.gate).join(", ")}: ${held[0].last_reason}). Only he can merge it now.`,
    };
  const pr = await prFor(task, true);
  if (!pr || pr.state !== "OPEN" || !pr.head)
    return { refusal: `${task.name} has no open PR` };
  const sha = pr.head;

  const repo = repoOf(task);
  const base = await fetchRefs(repo, task);
  const files = await changedFiles(repo, base, sha);
  const sensitive = sensitiveFiles(files);
  if (sensitive.length) {
    const what = sensitive.map((s) => `${s.path} (${s.why})`).join(", ");
    const why = `PR #${pr.number} at ${short(sha)} touches ${what}`;
    recordFailure(workspaceId, task.id, "sensitive", why);
    return { refusal: escalate(workspaceId, task, "sensitive", why, pr.url) };
  }

  const outcomes = evaluateGates({
    sha,
    checks: pr.checks,
    failing: pr.failing,
    review: getCheck(task.id, sha, "review"),
    ...(await waitingState(task)),
    ruleBreaks: ruleBreaks(files, await addedLines(repo, base, sha)),
    fromCard: !!task.lh_card_id,
    scope: getCheck(task.id, sha, "scope"),
    stackRefusal: landing ? null : signOffRefusal(task.id),
  });
  const failed = outcomes.filter((o) => o.state === "fail");
  const waiting = outcomes.filter((o) => o.state === "wait");
  if (!failed.length && !waiting.length)
    return { sha, pr: pr.number, url: pr.url };

  const lines = [
    ...failed.map((o) => countFailure(workspaceId, task, o, pr.url)),
    ...waiting.map((o) => `- ${o.gate}: not yet, ${o.reason}`),
  ];
  return {
    refusal: `${task.name} (PR #${pr.number} at ${short(sha)}) can't merge:\n${lines.join("\n")}`,
  };
}

function countFailure(
  workspaceId: string,
  task: Session,
  o: GateOutcome,
  url: string
): string {
  const n = recordFailure(workspaceId, task.id, o.gate, o.reason ?? "");
  const line = `- ${o.gate} failed (${n === 1 ? "first" : "again"}): ${o.reason}`;
  if (n < 2 || failureOf(task.id, o.gate)?.escalated_at) return line;
  const why = `the ${o.gate} gate failed twice: ${o.reason}`;
  return `${line}\n  ${escalate(workspaceId, task, o.gate, why, url)}`;
}

export async function signOff(
  workspaceId: string,
  ref: string
): Promise<string> {
  const task = workspaceTask(workspaceId, ref);
  const verdict = await judge(workspaceId, task);
  if ("refusal" in verdict) throw new Error(verdict.refusal);
  await signOffTask(task.id, { head: verdict.sha });
  addNote(
    workspaceId,
    `Merged ${task.name} (PR #${verdict.pr}, ${short(verdict.sha)}): CI green, review passed, in scope.`
  );
  return `Merged ${task.name}: PR #${verdict.pr} squash-merged at ${short(verdict.sha)}.`;
}

// Lands a stack only when every open item would pass sign-off now. Land
// restacks children between merges; their reviews were of the commits
// checked here.
export async function land(workspaceId: string, ref: string): Promise<string> {
  const stack = getStack(workspaceStack(workspaceId, ref).id);
  const open = stack.items.filter((i) => i.status === "pr" && i.taskId);
  const refusals: string[] = [];
  for (const item of open) {
    const task = workspaceTask(workspaceId, item.taskId!);
    const verdict = await judge(workspaceId, task, true);
    if ("refusal" in verdict) refusals.push(verdict.refusal);
  }
  if (refusals.length)
    throw new Error(`Not landing "${stack.name}":\n${refusals.join("\n")}`);
  const view = landInBackground(stack.id);
  addNote(
    workspaceId,
    `Landing stack "${view.name}": ${open.length} PRs, each through the gates.`
  );
  return `Landing "${view.name}" bottom-up in the background; stack_status shows progress.`;
}
