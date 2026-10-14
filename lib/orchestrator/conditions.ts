/**
 * What is true in a workspace right now, as keyed conditions. A condition
 * the orchestrator hasn't heard about yet is an event. Sticky conditions are
 * facts that stay true once seen (a PR opened, CI finished on a commit);
 * the others hold only while they last (a session needing input), so the
 * same thing happening again later can be news again (events.ts decides
 * when). Text another session wrote is fenced as untrusted.
 */

import { runForSession } from "../recipes/store";
import { db, type StackItemStatus, type StackStatus } from "../db";
import { isFinished, type TaskPR } from "../tasks/state";
import { ciWord } from "./describe";
import type { SessionFacts } from "./facts";
import { untrusted } from "./untrusted";

export interface Condition {
  key: string;
  // The session or stack item it's about, to forget it once that's gone.
  subject: string;
  line: string;
  sticky: boolean;
  // Worth a message only alongside others, or after a long wait.
  low?: boolean;
  // Someone is waiting: news even on the subject's first look.
  waiting?: boolean;
}

export interface StackFacts {
  id: string;
  name: string;
  status: StackStatus;
  items: {
    id: string;
    ticket: string | null;
    title: string;
    status: StackItemStatus;
    error: string | null;
  }[];
}

// How long after a task's turn ended with no PR before it is news: longer
// than the open-PR cache, so a PR it just opened is seen first.
export const NO_PR_AFTER_TURN_MS = 2 * 60 * 1000;

function hash(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

// A session's condition is keyed by what it is and the session.
export const conditionKey = (key: string, sessionId: string) =>
  `${key}:${sessionId}`;
// A PR's CI verdict on a head.
export const ciKey = (pr: Pick<TaskPR, "number" | "head" | "checks">) =>
  `ci:${pr.number}:${pr.head ?? ""}:${pr.checks}`;

function sessionConditions(
  f: SessionFacts,
  now: number,
  quiet: boolean
): Condition[] {
  const out: Condition[] = [];
  const add = (
    key: string,
    line: string,
    sticky = true,
    low = false,
    waiting = false
  ) =>
    out.push({
      key: conditionKey(key, f.id),
      subject: f.id,
      line,
      sticky,
      low,
      waiting,
    });
  const who = f.task ? `task ${f.name}` : f.name;
  const pr = f.task?.pr;

  if (pr?.state === "MERGED" || f.task?.state === "merged")
    add("merged", `${who}: merged`);
  else if (pr?.state === "OPEN") {
    add(`pr:${pr.number}`, `${who}: PR #${pr.number} opened (${ciWord(pr)})`);
    // Green is news once it has settled, when sign_off's ci gate passes,
    // so the orchestrator doesn't sign off into the settle window and poll.
    const settling = pr.checks === "pass" && (f.task?.ciSettleIn ?? 0) > 0;
    if ((pr.checks === "pass" && !settling) || pr.checks === "fail")
      add(
        ciKey(pr),
        `${who}: ${ciWord(pr)}${pr.checks === "pass" ? " and settled" : ""}`
      );
    // Mergeable for a long while with no check in a repository that has CI:
    // CI probably wasn't triggered. News once per head, never an escalation.
    if (pr.checks === "none" && f.task?.ciSilentMs !== undefined)
      add(
        `ci-silent:${pr.number}:${pr.head ?? ""}`,
        `${who}: PR #${pr.number} at ${(pr.head ?? "").slice(0, 7)} has been mergeable for ${Math.floor(f.task.ciSilentMs / 60000)}m with no CI check registered; CI may not have been triggered on this head`
      );
  }

  const blocked = f.task?.blocked ?? null;
  if (blocked !== null)
    add(
      `blocked:${hash(blocked)}`,
      `${who}: BLOCKED: ${blocked ? untrusted(f.name, blocked) : "(no reason given)"}`,
      true,
      false,
      true
    );
  else if (f.needsInput && !quiet)
    add(
      "needs",
      `${who}: needs input: ${f.activity ? untrusted(f.name, f.activity) : "waiting on an answer"}`,
      false,
      false,
      true
    );

  // Keyed on when it last did anything, so it is one event per stall and
  // anything the session does after it makes the next stall a new one.
  if (f.stalled)
    add(
      `stalled:${f.stalled.since}`,
      `${who}: stalled: no output for ${Math.floor(f.stalled.silentMs / 60000)}m mid-turn (last: ${untrusted(f.name, f.stalled.last)}). Read it; stop it if it's stuck.`,
      false,
      false,
      true
    );

  // A quick change is the orchestrator's own: nothing to tell it.
  // A recipe's session run reports through its settle event, not an alert.
  const shouldPR = (!!f.task || !!f.branch) && !f.quick && !runForSession(f.id);
  const finished = !!f.task && isFinished(f.task.state);
  const idleFor = now - f.lastActive;
  // A turn that ended with no PR and nothing blocked is stuck: it may
  // have opened a PR somewhere AgentOS doesn't look, or be waiting on
  // nothing. Keyed on when it last did anything, so it is one event per
  // stall and anything it does after makes the next stall a new one.
  if (
    shouldPR &&
    !pr &&
    !finished &&
    !f.plan?.awaiting &&
    f.status !== "running" &&
    blocked === null &&
    idleFor >= NO_PR_AFTER_TURN_MS
  )
    add(
      `no-pr:${f.lastActive}`,
      `${who}: ended its turn ${Math.floor(idleFor / 60000)}m ago with no PR${f.activity ? ` (last: ${untrusted(f.name, f.activity)})` : ""}. If it opened a PR in another repository, or finished without one, nothing tracks it.`,
      false,
      false,
      true
    );
  return out;
}

const STEP: Partial<Record<StackItemStatus, string>> = {
  running: "started",
  pr: "PR up",
  merged: "merged",
  failed: "failed",
  held: "held",
};

function stackConditions(s: StackFacts): Condition[] {
  const out: Condition[] = [];
  for (const item of s.items) {
    const step = STEP[item.status];
    if (!step) continue;
    const error =
      item.status === "failed" && item.error
        ? `: ${untrusted(`stack ${s.name}`, item.error)}`
        : "";
    out.push({
      key: `stack:${item.status}:${item.id}`,
      subject: item.id,
      line: `stack ${s.name}: ${item.ticket ?? item.title} ${step}${error}`,
      sticky: false,
    });
  }
  if (s.status !== "running")
    out.push({
      key: `stack-status:${s.status}:${s.id}`,
      subject: s.id,
      line: `stack ${s.name}: ${s.status}`,
      sticky: false,
    });
  return out;
}

// Sessions the orchestrator itself messaged this recently don't raise
// "needs input": that's most likely it waiting on its own question.
export const QUIET_AFTER_MESSAGE_MS = 2 * 60 * 1000;

export function conditionsFor(
  facts: SessionFacts[],
  stacks: StackFacts[],
  now = Date.now(),
  quiet: ReadonlySet<string> = new Set()
): Condition[] {
  return [
    ...facts.flatMap((f) => sessionConditions(f, now, quiet.has(f.id))),
    ...stacks.flatMap(stackConditions),
  ];
}

// The workspace's stacks still in play, or landed in the last day.
export function stackFacts(workspaceId: string): StackFacts[] {
  const stacks = db
    .prepare(
      `SELECT s.id, s.name, s.status FROM stacks s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ?
         AND (s.status != 'landed' OR s.landed_at > datetime('now', '-1 day'))`
    )
    .all(workspaceId) as Omit<StackFacts, "items">[];
  const items = db.prepare(
    `SELECT id, ticket, title, status, error FROM stack_items WHERE stack_id = ? ORDER BY position`
  );
  return stacks.map((s) => ({
    ...s,
    items: items.all(s.id) as StackFacts["items"],
  }));
}

// Sessions the orchestrator sent a bus message to in the quiet window.
export function recentlyMessaged(
  orchestratorId: string,
  now = Date.now()
): Set<string> {
  const since = new Date(now - QUIET_AFTER_MESSAGE_MS)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const rows = db
    .prepare(
      `SELECT DISTINCT to_id FROM bus_messages WHERE from_id = ? AND created_at >= ?`
    )
    .all(orchestratorId, since) as { to_id: string }[];
  return new Set(rows.map((r) => r.to_id));
}
