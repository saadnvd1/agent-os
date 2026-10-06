/**
 * The orchestrator's brakes, checked inside every tool that starts work:
 * at most N sessions running in the workspace, at most M starts an hour,
 * and never once the account's usage window would run out before it
 * resets. A brake refuses with its reason and pauses new starts only;
 * running work carries on. Each brake writes one note when it starts
 * holding, not one per refused start.
 */

import { db } from "../db";
import { chatState } from "../chat/runner";
import { statusDetector } from "../status-detector";
import { getWorkspace } from "../workspaces";
import { workspaceSessions } from "./facts";
import { addNote } from "./notes";
import { AskRefused, BRAKE_SUBJECT, raiseAsk, resolveAsks } from "./asks";
import { spendApproval, unspentApproval, voidApprovals } from "./ask-approvals";
import { isPaused } from "./pause";
import { readUsage, windowRefusal, type UsageState } from "./usage";

const HOUR = 60 * 60 * 1000;
// A session this young counts as running even before its status shows it.
const WARMUP_MS = 2 * 60 * 1000;

// A stack row marks a stack the orchestrator started; each of its cards
// is a start of its own, as a task.
export type StartKind = "task" | "session" | "stack";

const iso = (ms: number) => new Date(ms).toISOString();

function startsSince(workspaceId: string, since: number) {
  return db
    .prepare(
      `SELECT target FROM orchestrator_starts
       WHERE workspace_id = ? AND created_at >= ? AND kind != 'stack'`
    )
    .all(workspaceId, iso(since)) as { target: string | null }[];
}

export async function runningCount(
  workspaceId: string,
  now = Date.now()
): Promise<number> {
  await statusDetector.refreshCache();
  const running = new Set<string>();
  for (const s of workspaceSessions(workspaceId)) {
    if (s.task_status && s.task_status !== "running") continue;
    const busy =
      s.view === "chat"
        ? chatState(s.id) === "running"
        : statusDetector.sessionExists(s.tmux_name) &&
          (await statusDetector.getStatus(s.tmux_name)) === "running";
    if (busy) running.add(s.id);
  }
  for (const { target } of startsSince(workspaceId, now - WARMUP_MS))
    if (target) running.add(target);
  return running.size;
}

// Every brake that holds now, by name, with its reason.
export async function brakesOn(
  workspaceId: string,
  opts: { now?: number; usage?: UsageState } = {}
): Promise<{ name: string; reason: string }[]> {
  const now = opts.now ?? Date.now();
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("Unknown workspace");
  const out: { name: string; reason: string }[] = [];
  const running = await runningCount(workspaceId, now);
  if (running >= ws.orch_max_running)
    out.push({
      name: "running",
      reason: `${running} sessions are running in ${ws.name}, at its limit of ${ws.orch_max_running}`,
    });
  const starts = startsSince(workspaceId, now - HOUR).length;
  if (starts >= ws.orch_max_starts_per_hour)
    out.push({
      name: "starts",
      reason: `${starts} starts in the last hour, at the limit of ${ws.orch_max_starts_per_hour}`,
    });
  const window = windowRefusal(opts.usage ?? readUsage());
  if (window) out.push({ name: "window", reason: window });
  return out;
}

// One start at a time per workspace, so two can't both pass the brakes.
const queues = new Map<string, Promise<unknown>>();

function serially<T>(workspaceId: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(workspaceId) ?? Promise.resolve()).then(job);
  const tail = run.catch(() => {});
  queues.set(workspaceId, tail);
  void tail.then(() => {
    if (queues.get(workspaceId) === tail) queues.delete(workspaceId);
  });
  return run;
}

const setBrake = (workspaceId: string, key: string | null) =>
  db
    .prepare(`UPDATE workspaces SET orch_brake = ? WHERE id = ?`)
    .run(key, workspaceId);

// No brake holds: the next one is noted and asked about afresh.
export function liftBrake(workspaceId: string): void {
  setBrake(workspaceId, null);
  resolveAsks(workspaceId, BRAKE_SUBJECT, "the brakes lifted");
  voidApprovals(workspaceId, BRAKE_SUBJECT);
}

// Saad's approval of a brake ask lets one start past the brakes, if he
// gave it lately; a stale one isn't a standing pass.
const BRAKE_APPROVAL_MS = 2 * HOUR;

// The reason no start may go now (noted and asked once per brake), or null.
async function refusal(workspaceId: string): Promise<string | null> {
  if (isPaused(workspaceId)) return "the orchestrator is paused by Saad";
  const on = await brakesOn(workspaceId);
  if (!on.length) {
    liftBrake(workspaceId);
    return null;
  }
  const key = on.map((b) => b.name).join("+");
  const reason = on.map((b) => b.reason).join("; ");
  // An approval is for the brake it was asked about, not whichever holds now.
  const approval = unspentApproval(
    workspaceId,
    BRAKE_SUBJECT,
    BRAKE_APPROVAL_MS
  );
  if (approval?.brake_key === key && spendApproval(approval.id)) {
    // Spent: the next refusal notes and asks again.
    setBrake(workspaceId, null);
    addNote(
      workspaceId,
      "One start past the brakes, on Saad's approval.",
      "brake"
    );
    return null;
  }
  if (getWorkspace(workspaceId)?.orch_brake !== key) {
    setBrake(workspaceId, key);
    addNote(
      workspaceId,
      `New starts paused: ${reason}. Running work carries on.`,
      "brake"
    );
    try {
      raiseAsk({
        workspaceId,
        subject: BRAKE_SUBJECT,
        kind: "brake",
        title: "New starts are braked",
        detail: `${reason}. Approve to let one more start through; running work carries on either way.`,
        brakeKey: key,
      });
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
    }
  }
  return reason;
}

function recordStart(
  workspaceId: string,
  kind: StartKind,
  target: string | null
): void {
  db.prepare(
    `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, ?, ?, ?)`
  ).run(workspaceId, kind, target, iso(Date.now()));
}

// Runs a start through the brakes: refuses with the reason when one holds,
// otherwise starts and counts it.
export function braked<T>(
  workspaceId: string,
  kind: StartKind,
  start: () => Promise<T>,
  target: (result: T) => string | null
): Promise<T> {
  return serially(workspaceId, async () => {
    const why = await refusal(workspaceId);
    if (why) throw new Error(`Brake: not starting a ${kind}: ${why}.`);
    const result = await start();
    recordStart(workspaceId, kind, target(result));
    return result;
  });
}

// The stack watcher asks before starting each card. A stack the
// orchestrator started is braked card by card, like any task it starts;
// one a person started isn't the orchestrator's to hold.
export async function stackStartGate(
  stackId: string,
  itemId: string
): Promise<string | null> {
  const row = db
    .prepare(
      `SELECT workspace_id FROM orchestrator_starts WHERE kind = 'stack' AND target = ?`
    )
    .get(stackId) as { workspace_id: string } | undefined;
  if (!row) return null;
  return serially(row.workspace_id, async () => {
    const why = await refusal(row.workspace_id);
    if (why) return `Held by the orchestrator's brakes: ${why}`;
    recordStart(row.workspace_id, "task", itemId);
    return null;
  });
}
