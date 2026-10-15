/**
 * Queued tasks: a task that can't start yet waits here instead of being
 * refused. It waits for a slot under its workspace's limit on running tasks
 * (`max_running_tasks`, off unless set), or for another task to finish
 * (`after`). The stack watcher's loop ticks it (lib/stacks/tick.ts), and the
 * load monitor nudges it when a held machine calms down. Each tick scores
 * the candidates (schedule.ts: priority, age, a resume bonus), lists each
 * one's holds (holds.ts: after, Pause, the usage window, machine load,
 * simulators, start spacing, then the slot limit) and starts what has none,
 * best first. A start the home machine's load rules out goes to a linked
 * machine that is free (queue-placement.ts, placement.ts).
 *
 * This file is the request side (queueing, start now, priority, removal) and
 * the public face: the parts live in queue-types, queue-rows, queue-view,
 * queue-candidates, queue-placement, queue-start and queue-tick.
 *
 * A row's id is the session id it starts as, and it's claimed ('starting')
 * before the task is created, so a restart never starts one twice. Nothing
 * is deleted: a started or removed row stays as history.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { isPaused } from "../orchestrator/pause";
import { BrakeRefused, recordStart } from "../orchestrator/brakes";
import { discardQueuedHeld, queuedLabel } from "./queue-held";
import { DEFAULT_PRIORITY, isPriority, type Priority } from "./schedule-types";
import { meetsNeeds, needsFromSetting, parseNeeds } from "./placement";
import { machineCapabilities } from "../load/machines";
import { claimPiece } from "../plans/claim";
import { loadHeldStart, needsUnmetHere, requestNeeds } from "./hold-checks";
import {
  limitOf,
  patch,
  reserved,
  resolveAfter,
  row,
  runningIn,
  sessionOf,
  slotState,
  startingIn,
  stillWorking,
  waitingIn,
  workspaceOf,
} from "./queue-rows";
import { announce, startRow } from "./queue-start";
import { queuedView } from "./queue-view";
import { tickQueueSoon } from "./queue-tick";
import type {
  ForcedStart,
  QueueRequest,
  QueueRow,
  QueuedTaskView,
  StartOutcome,
} from "./queue-types";

export { queuedLabel };
export { START_ATTEMPTS } from "./queue-types";
export type {
  ForcedStart,
  QueueRequest,
  QueueRow,
  QueueStatus,
  QueuedTaskView,
  StartOutcome,
} from "./queue-types";
export { afterMet, hasFinished, resolveAfter, slotState } from "./queue-rows";
export { findQueued, listQueue, queuedView } from "./queue-view";
export { tickOnce, tickQueue, tickQueueSoon } from "./queue-tick";

// Queues the task when it can't start now: it has an `after`, or its
// workspace is at its limit (or already has a line waiting for a slot).
// Null means start it as usual.
export function queueIfNeeded(req: QueueRequest): QueuedTaskView | null {
  const project = getProject(req.projectId);
  if (!project) throw new Error("Pick a project");
  const workspaceId = project.workspace_id ?? null;
  const limit = limitOf(workspaceId);
  let afterTask: string | null = null;
  let afterAny: string[] | null = null;
  const after = req.after?.trim();
  // "any" with nothing working is nothing to wait for: it starts at once.
  let waits = !!after;
  if (after && after.toLowerCase() === "any") {
    afterAny = runningIn({ workspaceId, projectId: project.id }).filter(
      stillWorking
    );
    if (!afterAny.length) {
      afterAny = null;
      waits = false;
    }
  } else if (after)
    afterTask = resolveAfter(after, req.originWorkspaceId ?? workspaceId).id;
  if (req.now && waits)
    throw new Error("now and after don't go together: now starts it at once");
  const full =
    !req.planOnly &&
    !req.now &&
    limit !== null &&
    !!workspaceId &&
    (runningIn({ workspaceId, projectId: project.id }, true).length +
      startingIn(workspaceId) >=
      limit ||
      waitingIn(workspaceId) > 0);
  if (req.priority !== undefined && !isPriority(req.priority))
    throw new Error(`Priority is one of: urgent, blocking, normal, background`);
  const setting = needsFromSetting(req.machine);
  if (req.machine !== undefined && !setting)
    throw new Error(`Machine is "any" or "mac"`);
  // The orchestrator's own starts wait out a loaded machine; a person's
  // direct start goes ahead, as "start now" always has.
  if (
    req.now &&
    !req.planOnly &&
    needsUnmetHere(project.id, req.prompt, setting)
  )
    throw new Error(
      `Can't start now: this task needs a Mac, and this machine isn't one. Queue it without now.`
    );
  const loaded =
    !waits &&
    !full &&
    !req.now &&
    !req.planOnly &&
    !!req.originWorkspaceId &&
    loadHeldStart(project.id, req.prompt, setting);
  if (!waits && !full && !loaded) return null;
  if (!req.prompt.trim()) throw new Error("Describe the task");
  const id = randomUUID();
  // The row and the piece claim stand or fall together.
  db.transaction(() => {
    db.prepare(
      `INSERT INTO task_queue (id, project_id, prompt, name, model, model_overrides, plan, plan_reason, plan_only, started_by, parent_session_id, started_by_device, started_via, view, agent_type, base_branch,
         host_id, after_task, after_any, origin_workspace_id, priority, machine_needs, position)
       VALUES (@id, @project_id, @prompt, @name, @model, @model_overrides, @plan, @plan_reason, @plan_only, @started_by, @parent_session_id, @started_by_device, @started_via, @view, @agent_type, @base_branch,
         @host_id, @after_task, @after_any, @origin, @priority, @machine_needs,
         (SELECT COALESCE(MAX(position), 0) + 1 FROM task_queue))`
    ).run({
      id,
      project_id: project.id,
      prompt: req.prompt.trim(),
      name: req.name?.trim() || null,
      model: typeof req.model === "string" ? req.model || null : null,
      model_overrides:
        req.model && typeof req.model === "object"
          ? JSON.stringify(req.model)
          : null,
      plan: req.plan === undefined ? null : req.plan ? 1 : 0,
      plan_reason: req.planReason?.trim() || null,
      plan_only: req.planOnly ? 1 : null,
      started_by: req.startedBy ?? null,
      parent_session_id: req.parentSessionId ?? null,
      started_by_device: req.startedByDevice ?? null,
      started_via: req.startedVia,
      view: req.view ?? null,
      agent_type: req.agent ?? null,
      base_branch: req.baseBranch || null,
      host_id: req.hostId || null,
      after_task: afterTask,
      after_any: afterAny ? JSON.stringify(afterAny) : null,
      origin: req.originWorkspaceId ?? null,
      priority: req.priority ?? DEFAULT_PRIORITY,
      machine_needs: setting ? JSON.stringify(setting) : null,
    });
    if (req.pieceId) claimPiece(req.pieceId, id);
  })();
  tickQueueSoon();
  return queuedView(id)!;
}

// Queues the task, or starts it with `start` holding its slot until its
// row exists, so two starts at once can't both take the last slot.
export async function startOrQueue<T>(
  req: QueueRequest,
  start: () => Promise<T>
): Promise<{ queued: QueuedTaskView } | { started: T }> {
  const queued = queueIfNeeded(req);
  if (queued) return { queued };
  const workspaceId = workspaceOf(req.projectId);
  // A plan-only start never holds a slot, as its queue row doesn't.
  if (!workspaceId || req.planOnly) return { started: await start() };
  reserved.set(workspaceId, (reserved.get(workspaceId) ?? 0) + 1);
  try {
    return { started: await start() };
  } finally {
    const left = (reserved.get(workspaceId) ?? 1) - 1;
    if (left > 0) reserved.set(workspaceId, left);
    else reserved.delete(workspaceId);
  }
}

// A person's "start now": past the limit, its `after` and (for a task a
// person queued) Pause. The orchestrator's queued tasks still pass its
// brakes; a refusal is thrown.
export async function startQueuedNow(id: string): Promise<StartOutcome> {
  const r = row(id);
  if (!r || r.status !== "queued")
    throw new Error("That task isn't waiting in the queue");
  return startRow(r, { force: true });
}

// The orchestrator's start now: past the limit and `after`, never past
// Pause, its brakes or a machine need. A held task stays queued.
export async function startQueuedForOrchestrator(
  workspaceId: string,
  id: string
): Promise<ForcedStart> {
  const r = row(id);
  const project = r ? getProject(r.project_id) : null;
  if (!r || r.status !== "queued" || project?.workspace_id !== workspaceId)
    throw new Error("That task isn't waiting in the queue");
  const slots = slotState(r.project_id);
  const base = {
    wasFull: slots.full,
    running: slots.running,
    limit: slots.limit,
    skippedAfter: !!(r.after_task || r.after_any),
  };
  const held = (text: string): ForcedStart => ({
    ...base,
    outcome: "held",
    text,
  });
  if (isPaused(workspaceId)) return held("the orchestrator is paused by Saad");
  if (isRemoteHost(r.host_id ?? project.host_id))
    return held(
      "it runs on another machine, and the orchestrator starts tasks on this one only"
    );
  if (
    !meetsNeeds(
      parseNeeds(r.machine_needs) ??
        requestNeeds(project.id, project.working_directory, r.prompt, null),
      machineCapabilities()
    )
  )
    return held("it needs a Mac, and this machine isn't one");
  try {
    const outcome = await startRow(r, { force: true, brakeAs: workspaceId });
    if (outcome === "started") return { ...base, outcome, text: "" };
    return held("it could not be claimed just now; try again");
  } catch (error) {
    if (error instanceof BrakeRefused) return held(error.reason);
    return {
      ...base,
      outcome: "failed",
      text: row(id)?.error ?? String(error),
    };
  }
}

// Changes the priority of a queued task or a running one (they share an
// id). Age is kept. Throws when no such task is waiting or running.
export function setPriority(id: string, priority: Priority): void {
  if (!isPriority(priority))
    throw new Error("Priority is one of: urgent, blocking, normal, background");
  const queued = db
    .prepare(
      `UPDATE task_queue SET priority = ? WHERE id = ? AND status IN ('queued', 'failed')`
    )
    .run(priority, id).changes;
  const running = db
    .prepare(
      `UPDATE sessions SET priority = ? WHERE id = ? AND task_status IS NOT NULL AND archived_at IS NULL`
    )
    .run(priority === DEFAULT_PRIORITY ? null : priority, id).changes;
  if (!queued && !running) throw new Error("No such queued or running task");
  tickQueueSoon();
}

// A task started directly (never queued) keeps the priority it was given.
export function stampPriority(id: string, priority: Priority | undefined) {
  if (!priority || priority === DEFAULT_PRIORITY) return;
  db.prepare(`UPDATE sessions SET priority = ? WHERE id = ?`).run(priority, id);
}

export function removeQueued(id: string): void {
  const changed = db.transaction(() => {
    const n = db
      .prepare(
        `UPDATE task_queue SET status = 'removed' WHERE id = ? AND status IN ('queued', 'failed')`
      )
      .run(id).changes;
    if (n) discardQueuedHeld(id);
    return n;
  })();
  if (!changed) throw new Error("That task isn't waiting in the queue");
  tickQueueSoon();
}

// Swaps it with the next queued task above (-1) or below (+1) it in its
// workspace's line.
export function moveQueued(id: string, by: -1 | 1): void {
  db.transaction(() => {
    const r = row(id);
    if (!r || r.status !== "queued")
      throw new Error("That task isn't waiting in the queue");
    const workspaceId = workspaceOf(r.project_id);
    const other = db
      .prepare(
        `SELECT q.* FROM task_queue q JOIN projects p ON p.id = q.project_id
         WHERE q.status = 'queued' AND q.position ${by < 0 ? "<" : ">"} @position
           AND ${workspaceId ? "p.workspace_id = @ws" : "q.project_id = @project"}
         ORDER BY q.position ${by < 0 ? "DESC" : "ASC"} LIMIT 1`
      )
      .get({ position: r.position, ws: workspaceId, project: r.project_id }) as
      | QueueRow
      | undefined;
    if (!other) return;
    patch(r.id, { position: other.position });
    patch(other.id, { position: r.position });
  })();
  tickQueueSoon();
}

// After a restart: a row caught between its claim and its task either got
// its task (started: counted by the brakes and announced, which the cut-off
// start never got to) or never did (back in line).
export function recoverQueue(): void {
  const rows = db
    .prepare(`SELECT * FROM task_queue WHERE status = 'starting'`)
    .all() as QueueRow[];
  for (const r of rows) {
    const session = sessionOf(r.id);
    if (!session?.task_status) {
      patch(r.id, { status: "queued" });
      continue;
    }
    patch(r.id, { status: "started", started_at: new Date().toISOString() });
    if (r.origin_workspace_id) recordStart(r.origin_workspace_id, "task", r.id);
    announce(r, session);
  }
}
