/**
 * What is true in a workspace right now, as keyed conditions. A condition
 * the orchestrator hasn't heard about yet is an event. Sticky conditions are
 * facts that stay true once seen (a PR opened, CI finished on a commit);
 * the others hold only while they last (a session needing input), so the
 * same thing happening again later can be news again (events.ts decides
 * when). Text another session wrote is fenced as untrusted.
 */

import { db, type StackItemStatus, type StackStatus } from "../db";
import { isFinished } from "../tasks/state";
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

export const IDLE_NO_PR_MS = 30 * 60 * 1000;

function hash(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

function sessionConditions(
  f: SessionFacts,
  now: number,
  quiet: boolean
): Condition[] {
  const out: Condition[] = [];
  const add = (key: string, line: string, sticky = true, low = false) =>
    out.push({ key: `${key}:${f.id}`, subject: f.id, line, sticky, low });
  const who = f.task ? `task ${f.name}` : f.name;
  const pr = f.task?.pr;

  if (pr?.state === "MERGED" || f.task?.state === "merged")
    add("merged", `${who}: merged`);
  else if (pr?.state === "OPEN") {
    add(`pr:${pr.number}`, `${who}: PR #${pr.number} opened (${ciWord(pr)})`);
    if (pr.checks === "pass" || pr.checks === "fail")
      add(
        `ci:${pr.number}:${pr.head ?? ""}:${pr.checks}`,
        `${who}: ${ciWord(pr)}`
      );
  }

  const blocked = f.task?.blocked ?? null;
  if (blocked !== null)
    add(
      `blocked:${hash(blocked)}`,
      `${who}: BLOCKED: ${blocked ? untrusted(f.name, blocked) : "(no reason given)"}`
    );
  else if (f.needsInput && !quiet)
    add(
      "needs",
      `${who}: needs input: ${f.activity ? untrusted(f.name, f.activity) : "waiting on an answer"}`,
      false
    );

  const shouldPR = !!f.task || !!f.branch;
  const finished = !!f.task && isFinished(f.task.state);
  const idleFor = now - f.lastActive;
  if (
    shouldPR &&
    !pr &&
    !finished &&
    f.status !== "running" &&
    idleFor >= IDLE_NO_PR_MS
  )
    add(
      "idle",
      `${who}: idle ${Math.floor(idleFor / 60000)}m, no PR`,
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
