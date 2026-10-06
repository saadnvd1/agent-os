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
import { readUsageWindow, windowRefusal, type UsageWindow } from "./usage";

const HOUR = 60 * 60 * 1000;
// A session this young counts as running even before its status shows it.
const WARMUP_MS = 2 * 60 * 1000;

export type StartKind = "task" | "session" | "stack";

const iso = (ms: number) => new Date(ms).toISOString();

function startsSince(workspaceId: string, since: number) {
  return db
    .prepare(
      `SELECT target FROM orchestrator_starts WHERE workspace_id = ? AND created_at >= ?`
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
  opts: { now?: number; usage?: UsageWindow | null } = {}
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
  const window = windowRefusal(
    opts.usage === undefined ? readUsageWindow() : opts.usage
  );
  if (window) out.push({ name: "window", reason: window });
  return out;
}

// One start at a time per workspace, so two can't both pass the brakes.
const queues = new Map<string, Promise<unknown>>();

// Runs a start through the brakes: refuses with the reason when one holds
// (noting it once), otherwise starts and counts it.
export function braked<T>(
  workspaceId: string,
  kind: StartKind,
  start: () => Promise<T>,
  target: (result: T) => string | null
): Promise<T> {
  const run = (queues.get(workspaceId) ?? Promise.resolve()).then(() =>
    brakedNow(workspaceId, kind, start, target)
  );
  const tail = run.catch(() => {});
  queues.set(workspaceId, tail);
  void tail.then(() => {
    if (queues.get(workspaceId) === tail) queues.delete(workspaceId);
  });
  return run;
}

async function brakedNow<T>(
  workspaceId: string,
  kind: StartKind,
  start: () => Promise<T>,
  target: (result: T) => string | null
): Promise<T> {
  const on = await brakesOn(workspaceId);
  if (on.length) {
    const key = on.map((b) => b.name).join("+");
    const ws = getWorkspace(workspaceId)!;
    const reason = on.map((b) => b.reason).join("; ");
    if (ws.orch_brake !== key) {
      db.prepare(`UPDATE workspaces SET orch_brake = ? WHERE id = ?`).run(
        key,
        workspaceId
      );
      addNote(
        workspaceId,
        `New starts paused: ${reason}. Running work carries on.`,
        "brake"
      );
    }
    throw new Error(`Brake: not starting a ${kind}: ${reason}.`);
  }
  db.prepare(`UPDATE workspaces SET orch_brake = NULL WHERE id = ?`).run(
    workspaceId
  );
  const result = await start();
  db.prepare(
    `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, ?, ?, ?)`
  ).run(workspaceId, kind, target(result), iso(Date.now()));
  return result;
}
