/**
 * Queued tasks: a task that can't start yet waits here instead of being
 * refused. It waits for a slot under its workspace's limit on running tasks
 * (`max_running_tasks`, off unless set), or for another task to finish
 * (`after`). The stack watcher's loop ticks it (lib/stacks/tick.ts), with
 * the same slot filling as stacks: in line order, up to the limit, skipping
 * one whose `after` hasn't happened.
 *
 * A row's id is the session id it starts as, and it's claimed ('starting')
 * before the task is created, so a restart never starts one twice. Nothing
 * is deleted: a started or removed row stays as history.
 */

import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { fillSlots } from "../stacks/ready";
import { isPaused } from "../orchestrator/pause";
import {
  BrakeRefused,
  braked,
  brakesEnabled,
  recordStart,
} from "../orchestrator/brakes";
import { queueEvent } from "../orchestrator/events";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import { createTask } from "./index";

export type QueueStatus =
  | "queued"
  | "starting"
  | "started"
  | "failed"
  | "removed";

export interface QueueRow {
  id: string;
  project_id: string;
  prompt: string;
  name: string | null;
  model: string | null;
  view: "chat" | "terminal" | null;
  base_branch: string | null;
  host_id: string | null;
  // A task (or queued task) it waits on, by id.
  after_task: string | null;
  // "after any": the tasks running when it was queued, as JSON; the first
  // of them to finish lets it go.
  after_any: string | null;
  // The orchestrator's workspace, when the orchestrator queued it: its
  // start goes through that orchestrator's brakes.
  origin_workspace_id: string | null;
  position: number;
  status: QueueStatus;
  note: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
}

// What the UI and tools see of a queued task. No server imports needed.
export interface QueuedTaskView {
  id: string;
  name: string;
  prompt: string;
  projectId: string;
  projectName: string | null;
  status: QueueStatus;
  // 1-based place in its workspace's line.
  position: number;
  // What it waits on: a task's name, or "any running task".
  after: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
}

export const START_ATTEMPTS = 3;
const IN_FLIGHT = ["running", "moving"];

const row = (id: string) =>
  db.prepare(`SELECT * FROM task_queue WHERE id = ?`).get(id) as
    | QueueRow
    | undefined;

const sessionOf = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

function patch(id: string, fields: Partial<QueueRow>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(
    `UPDATE task_queue SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`
  ).run({ ...fields, id });
}

const workspaceOf = (projectId: string) =>
  getProject(projectId)?.workspace_id ?? null;

// Running tasks hold their slot until they finish (merged, dropped, done),
// PR open or not; a queued task being started counts too. Without a
// workspace, the project is the scope.
function runningIn(scope: { workspaceId: string | null; projectId: string }) {
  const where = scope.workspaceId
    ? `p.workspace_id = @ws`
    : `p.id = @project AND p.workspace_id IS NULL`;
  return (
    db
      .prepare(
        `SELECT s.id FROM sessions s JOIN projects p ON p.id = s.project_id
         WHERE ${where} AND s.archived_at IS NULL
           AND s.task_status IN (${IN_FLIGHT.map((s) => `'${s}'`).join(", ")})`
      )
      .all({ ws: scope.workspaceId, project: scope.projectId }) as {
      id: string;
    }[]
  ).map((r) => r.id);
}

function startingIn(workspaceId: string): number {
  return (
    (reserved.get(workspaceId) ?? 0) +
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM task_queue q JOIN projects p ON p.id = q.project_id
         WHERE q.status = 'starting' AND p.workspace_id = ?`
        )
        .get(workspaceId) as { n: number }
    ).n
  );
}

const limitOf = (workspaceId: string | null) =>
  workspaceId ? (getWorkspace(workspaceId)?.max_running_tasks ?? null) : null;

// Finished, as far as a wait on it goes: merged, dropped, done or handed to
// another machine, or a queued task that was removed or failed to start.
export function hasFinished(taskId: string): boolean {
  const s = sessionOf(taskId);
  if (s) return !!s.archived_at || !IN_FLIGHT.includes(s.task_status ?? "");
  const q = row(taskId);
  return !q || (q.status !== "queued" && q.status !== "starting");
}

export function afterMet(r: QueueRow): boolean {
  if (r.after_task && !hasFinished(r.after_task)) return false;
  if (r.after_any) {
    const ids = JSON.parse(r.after_any) as string[];
    if (ids.length && !ids.some(hasFinished)) return false;
  }
  return true;
}

// A task named by id, id prefix or name, running or queued; in one
// workspace when given (the orchestrator's).
export function resolveAfter(
  ref: string,
  workspaceId: string | null
): { id: string; name: string } {
  const want = ref.trim();
  const lower = want.toLowerCase();
  const scope = workspaceId ? `AND p.workspace_id = @ws` : "";
  const candidates = db
    .prepare(
      `SELECT s.id, s.name FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE s.archived_at IS NULL AND s.task_status IN ('running', 'moving') ${scope}
       UNION ALL
       SELECT q.id, COALESCE(q.name, q.prompt) AS name FROM task_queue q
         JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting') ${scope}`
    )
    .all({ ws: workspaceId }) as { id: string; name: string }[];
  const exact = candidates.filter(
    (c) => c.id === want || c.name.toLowerCase() === lower
  );
  const hits = exact.length
    ? exact
    : want.length >= 4
      ? candidates.filter((c) => c.id.startsWith(want))
      : [];
  if (hits.length === 1) return hits[0];
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches ${hits.length} tasks: ${hits.map((h) => `${h.name} (${h.id.slice(0, 8)})`).join(", ")}`
    );
  throw new Error(`No running or queued task matches "${ref}"`);
}

export interface QueueRequest {
  projectId: string;
  prompt: string;
  name?: string;
  model?: string;
  view?: "chat" | "terminal";
  baseBranch?: string;
  hostId?: string;
  // A task's id or name, or "any" for whichever running task finishes first.
  after?: string;
  // Set when the orchestrator starts it.
  originWorkspaceId?: string;
}

const waitingIn = (workspaceId: string) =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_queue q JOIN projects p ON p.id = q.project_id
         WHERE q.status = 'queued' AND p.workspace_id = ?
           AND q.after_task IS NULL AND q.after_any IS NULL`
      )
      .get(workspaceId) as { n: number }
  ).n;

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
  if (after && after.toLowerCase() === "any")
    afterAny = runningIn({ workspaceId, projectId: project.id });
  else if (after)
    afterTask = resolveAfter(after, req.originWorkspaceId ?? workspaceId).id;
  const full =
    limit !== null &&
    !!workspaceId &&
    (runningIn({ workspaceId, projectId: project.id }).length +
      startingIn(workspaceId) >=
      limit ||
      waitingIn(workspaceId) > 0);
  if (!after && !full) return null;
  if (!req.prompt.trim()) throw new Error("Describe the task");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO task_queue (id, project_id, prompt, name, model, view, base_branch,
       host_id, after_task, after_any, origin_workspace_id, position)
     VALUES (@id, @project_id, @prompt, @name, @model, @view, @base_branch,
       @host_id, @after_task, @after_any, @origin,
       (SELECT COALESCE(MAX(position), 0) + 1 FROM task_queue))`
  ).run({
    id,
    project_id: project.id,
    prompt: req.prompt.trim(),
    name: req.name?.trim() || null,
    model: req.model || null,
    view: req.view ?? null,
    base_branch: req.baseBranch || null,
    host_id: req.hostId || null,
    after_task: afterTask,
    after_any: afterAny ? JSON.stringify(afterAny) : null,
    origin: req.originWorkspaceId ?? null,
  });
  tickQueueSoon();
  return queuedView(id)!;
}

// Direct starts under way, by workspace: their task rows don't exist until
// createTask gets that far, so they hold their slot here meanwhile.
const reserved = new Map<string, number>();

// Queues the task, or starts it with `start` holding its slot until its
// row exists, so two starts at once can't both take the last slot.
export async function startOrQueue<T>(
  req: QueueRequest,
  start: () => Promise<T>
): Promise<{ queued: QueuedTaskView } | { started: T }> {
  const queued = queueIfNeeded(req);
  if (queued) return { queued };
  const workspaceId = workspaceOf(req.projectId);
  if (!workspaceId) return { started: await start() };
  reserved.set(workspaceId, (reserved.get(workspaceId) ?? 0) + 1);
  try {
    return { started: await start() };
  } finally {
    const left = (reserved.get(workspaceId) ?? 1) - 1;
    if (left > 0) reserved.set(workspaceId, left);
    else reserved.delete(workspaceId);
  }
}

function label(r: Pick<QueueRow, "name" | "prompt">): string {
  if (r.name) return r.name;
  const line = r.prompt.split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

function afterLabel(r: QueueRow): string | null {
  if (r.after_task) {
    const s = sessionOf(r.after_task);
    const q = s ? null : row(r.after_task);
    return s?.name ?? (q ? label(q) : r.after_task.slice(0, 8));
  }
  return r.after_any ? "any running task" : null;
}

// Every task still in line (and any that failed to start), in line order.
export function listQueue(): QueuedTaskView[] {
  const rows = db
    .prepare(
      `SELECT q.*, p.name AS project_name, p.workspace_id AS workspace_id
       FROM task_queue q LEFT JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting', 'failed')
       ORDER BY q.position`
    )
    .all() as (QueueRow & {
    project_name: string | null;
    workspace_id: string | null;
  })[];
  const places = new Map<string, number>();
  return rows.map((r) => {
    const key = r.workspace_id ?? `project:${r.project_id}`;
    const place = (places.get(key) ?? 0) + 1;
    places.set(key, place);
    return {
      id: r.id,
      name: label(r),
      prompt: r.prompt,
      projectId: r.project_id,
      projectName: r.project_name,
      status: r.status,
      position: place,
      after: afterLabel(r),
      note: r.note,
      error: r.error,
      createdAt: r.created_at,
    };
  });
}

export const queuedView = (id: string) =>
  listQueue().find((q) => q.id === id) ?? null;

// Why an automatic start has to wait, or null. A start now by a person
// isn't held.
function autoHold(workspaceId: string | null): string | null {
  if (workspaceId && isPaused(workspaceId))
    return "Waiting: the orchestrator is paused";
  const window = brakesEnabled() ? windowRefusal(readUsage()) : null;
  return window ? `Waiting: ${window}` : null;
}

export type StartOutcome = "started" | "held" | "retry" | "failed";

// Tells the orchestrator that queued it that it started.
function announce(
  r: Pick<QueueRow, "id" | "origin_workspace_id">,
  session: Pick<Session, "name" | "branch_name">
): void {
  if (!r.origin_workspace_id) return;
  queueEvent(
    r.origin_workspace_id,
    `queued-start:${r.id}`,
    r.id,
    `Queued task "${session.name}" (id ${r.id.slice(0, 8)}) started on ${session.branch_name ?? "its branch"}.`
  );
}

async function startRow(
  r: QueueRow,
  opts: { force?: boolean } = {}
): Promise<StartOutcome> {
  const workspaceId = workspaceOf(r.project_id);
  if (!opts.force) {
    const held = autoHold(workspaceId);
    if (held) {
      if (r.note !== held) patch(r.id, { note: held });
      return "held";
    }
  }
  const claimed = db
    .prepare(
      `UPDATE task_queue SET status = 'starting', note = NULL WHERE id = ? AND status = 'queued'`
    )
    .run(r.id).changes;
  if (!claimed) return "held";
  const task = {
    id: r.id,
    projectId: r.project_id,
    prompt: r.prompt,
    name: r.name ?? undefined,
    model: r.model ?? undefined,
    view: r.view ?? undefined,
    baseBranch: r.base_branch ?? undefined,
    hostId: r.host_id ?? undefined,
  };
  const origin = r.origin_workspace_id;
  try {
    // The orchestrator's queued starts pass its brakes when they start,
    // a person's "start now" included: it skips only the limit and `after`.
    const session = origin
      ? await braked(
          origin,
          "task",
          () => createTask(task),
          (s) => s.id,
          { spendApproval: false }
        )
      : await createTask(task);
    patch(r.id, {
      status: "started",
      started_at: new Date().toISOString(),
      error: null,
      note: null,
    });
    announce(r, session);
    return "started";
  } catch (error) {
    if (error instanceof BrakeRefused) {
      patch(r.id, { status: "queued", note: `Waiting: ${error.reason}` });
      if (opts.force) throw error;
      return "held";
    }
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 300);
    // Its row exists: the task is there, only its launch failed.
    if (sessionOf(r.id)?.task_status) {
      patch(r.id, { status: "started", started_at: new Date().toISOString() });
      return "started";
    }
    const attempts = r.attempts + 1;
    const retry = attempts < START_ATTEMPTS && !opts.force;
    patch(r.id, {
      status: retry ? "queued" : "failed",
      attempts,
      error: retry
        ? `Start failed (try ${attempts} of ${START_ATTEMPTS}), trying again: ${message}`
        : `Could not start: ${message}`,
    });
    return retry ? "retry" : "failed";
  }
}

// One look at the line: per workspace, what fits under its limit, in order,
// with its `after` met. Pure, for tests: rows in, ids to start out.
export function planQueue(
  rows: (QueueRow & { workspace_id: string | null })[],
  running: (scope: { workspaceId: string | null; projectId: string }) => number,
  limit: (workspaceId: string | null) => number | null,
  ready: (r: QueueRow) => boolean
): string[] {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.workspace_id ?? `project:${r.project_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const start: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const scope = {
      workspaceId: first.workspace_id,
      projectId: first.project_id,
    };
    const max = limit(first.workspace_id) ?? Number.POSITIVE_INFINITY;
    const queued = group.filter((r) => r.status === "queued");
    const inFlight =
      running(scope) + group.filter((r) => r.status === "starting").length;
    start.push(...fillSlots(queued, inFlight, max, ready).map((r) => r.id));
  }
  return start;
}

async function tickOnce(): Promise<void> {
  const rows = db
    .prepare(
      `SELECT q.*, p.workspace_id AS workspace_id FROM task_queue q
       JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting') ORDER BY q.position`
    )
    .all() as (QueueRow & { workspace_id: string | null })[];
  if (!rows.length) return;
  const plan = planQueue(
    rows,
    (scope) =>
      runningIn(scope).length +
      (scope.workspaceId ? (reserved.get(scope.workspaceId) ?? 0) : 0),
    limitOf,
    afterMet
  );
  for (const id of plan) {
    const r = row(id);
    if (r?.status === "queued") await startRow(r);
  }
}

// One look at a time; a call during one shares it.
let ticking: Promise<void> | null = null;

export function tickQueue(): Promise<void> {
  ticking ??= tickOnce().finally(() => {
    ticking = null;
  });
  return ticking;
}

export function tickQueueSoon(): void {
  void tickQueue().catch((error: unknown) =>
    console.error("[queue] tick:", error)
  );
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

export function removeQueued(id: string): void {
  const changed = db
    .prepare(
      `UPDATE task_queue SET status = 'removed' WHERE id = ? AND status IN ('queued', 'failed')`
    )
    .run(id).changes;
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
