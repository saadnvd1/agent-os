/**
 * Queued tasks: a task that can't start yet waits here instead of being
 * refused. It waits for a slot under its workspace's limit on running tasks
 * (`max_running_tasks`, off unless set), or for another task to finish
 * (`after`). The stack watcher's loop ticks it (lib/stacks/tick.ts), and the
 * load monitor nudges it when a held machine calms down. Each tick scores
 * the candidates (lib/tasks/schedule.ts: priority, age, a resume bonus),
 * holds the ones a machine's load, simulators or start spacing rule out, and
 * starts what fits under the limit, best first. A start the home machine's
 * load rules out goes to a linked machine that is free (placement.ts).
 *
 * A row's id is the session id it starts as, and it's claimed ('starting')
 * before the task is created, so a restart never starts one twice. Nothing
 * is deleted: a started or removed row stays as history.
 */

import type { ModelOverride } from "../models/resolve";
import type { AgentType } from "../providers";
import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { isRemoteHost } from "../hosts";
import { getWorkspace } from "../workspaces";
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
import {
  discardQueuedHeld,
  markQueuedHeldDelivered,
  queuedHeldMessages,
  queuedLabel,
  queuedMessagesSection,
} from "./queue-held";
import { expandHome } from "./session";
import {
  DEFAULT_PRIORITY,
  isPriority,
  type Priority,
  type WaitCode,
} from "./schedule-types";
import {
  machineHold,
  planStarts,
  scoreParts,
  type Candidate,
  type Group,
  type Hold,
} from "./schedule";
import {
  heavyNeeds,
  meetsNeeds,
  needsFromSetting,
  needsOf,
  parseNeeds,
  place,
  unplaceable,
  wantsPlacing,
  type Need,
  type Placement,
  type PeerOption,
} from "./placement";
import {
  LOCAL,
  localView,
  machineCapabilities,
  recordAutoStart,
  viewOf,
} from "../load/machines";
import { peerReading, peerSource, refreshPeers } from "../hosts/peer-load";
import { hostLink, linkedHostIds } from "../hosts/remote-api";
import { hostTasks } from "./remote";
import { projectMachines } from "../hosts/project-machines";
import { claimResume, dueResumes } from "./pause";

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
  // A per-role model map (lib/models), when that's what it was given.
  model_overrides: string | null;
  // The starter's plan decision (1/0, null: not stated), its reason, and the
  // orchestrator session that started it.
  plan: number | null;
  plan_reason: string | null;
  plan_only: number | null;
  started_by: string | null;
  view: "chat" | "terminal" | null;
  agent_type: string | null;
  base_branch: string | null;
  host_id: string | null;
  // A task (or queued task) it waits on, by id.
  after_task: string | null;
  // "after any": the tasks running when it was queued, as JSON; the first
  // of them to finish lets it go.
  after_any: string | null;
  // The finish (a task id) this "after any" waiter took; one finish lets one
  // waiter go (a unique index keeps it so).
  after_any_used: string | null;
  priority: Priority;
  // What it needs from a machine, as JSON, when the starter said.
  machine_needs: string | null;
  // The code behind `note`, set by the scheduler.
  wait_code: WaitCode | null;
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
  // The workspace whose line it's in, or null for a project without one.
  workspaceId: string | null;
  status: QueueStatus;
  // 1-based place in its workspace's line.
  position: number;
  // What it waits on: a task's name, or "any running task".
  after: string | null;
  // The task it waits on, by id, when it waits on one.
  afterId: string | null;
  note: string | null;
  error: string | null;
  // The orchestrator session that queued it, when one did.
  startedBy: string | null;
  createdAt: string;
  priority: Priority;
  // Why it isn't starting, from the scheduler; null: nothing but its turn.
  wait: WaitCode | null;
  // Its place in the score order within its line, and how many are in it.
  rank: number;
  of: number;
  // Messages held for it until it starts.
  held: number;
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
// PR open or not; a queued task being started counts too. A paused task
// gives its slot back until it resumes. A quick change
// runs no agent, so it holds none. Without a
// workspace, the project is the scope.
function runningIn(
  scope: { workspaceId: string | null; projectId: string },
  forSlots = false
) {
  const where = scope.workspaceId
    ? `p.workspace_id = @ws`
    : `p.id = @project AND p.workspace_id IS NULL`;
  return (
    db
      .prepare(
        `SELECT s.id FROM sessions s JOIN projects p ON p.id = s.project_id
         WHERE ${where} AND s.archived_at IS NULL AND s.quick_of IS NULL
           AND (s.pause_state IS NULL OR s.pause_state != 'paused')
           ${forSlots ? `AND NOT (COALESCE(s.plan_only, 0) = 1 AND COALESCE(s.plan_phase, '') != 'implementing')` : ""}
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
         WHERE q.status = 'starting' AND p.workspace_id = ?
           AND q.plan_only IS NULL`
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

// Still something to wait for under "any": in flight, and not a task whose
// PR was closed or merged and which nobody finished (that one never will).
function stillWorking(taskId: string): boolean {
  if (hasFinished(taskId)) return false;
  const s = sessionOf(taskId);
  return !s || (s.pr_status !== "closed" && s.pr_status !== "merged");
}

export function afterMet(r: QueueRow): boolean {
  if (r.after_task && !hasFinished(r.after_task)) return false;
  if (r.after_any && !r.after_any_used) {
    const ids = JSON.parse(r.after_any) as string[];
    if (ids.length && !ids.some((id) => !stillWorking(id))) return false;
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
  model?: ModelOverride;
  plan?: boolean;
  planReason?: string | null;
  planOnly?: boolean;
  startedBy?: string | null;
  view?: "chat" | "terminal";
  agent?: AgentType;
  baseBranch?: string;
  hostId?: string;
  // A task's id or name, or "any" for whichever running task finishes first.
  after?: string;
  // Set when the orchestrator starts it.
  originWorkspaceId?: string;
  // Where it sits among the queued: urgent, blocking, normal (the default)
  // or background.
  priority?: Priority;
  // "mac" pins it to a Mac; "any" says it needs nothing in particular.
  machine?: "any" | "mac";
}

const waitingIn = (workspaceId: string) =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_queue q JOIN projects p ON p.id = q.project_id
         WHERE q.status = 'queued' AND p.workspace_id = ?
           AND q.after_task IS NULL AND q.after_any IS NULL
           AND q.plan_only IS NULL`
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
  const full =
    !req.planOnly &&
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
  const loaded =
    !waits &&
    !full &&
    !req.planOnly &&
    !!req.originWorkspaceId &&
    loadHeldStart(project.id, req.prompt, setting);
  if (!waits && !full && !loaded) return null;
  if (!req.prompt.trim()) throw new Error("Describe the task");
  const id = randomUUID();
  db.prepare(
    `INSERT INTO task_queue (id, project_id, prompt, name, model, model_overrides, plan, plan_reason, plan_only, started_by, view, agent_type, base_branch,
       host_id, after_task, after_any, origin_workspace_id, priority, machine_needs, position)
     VALUES (@id, @project_id, @prompt, @name, @model, @model_overrides, @plan, @plan_reason, @plan_only, @started_by, @view, @agent_type, @base_branch,
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
  tickQueueSoon();
  return queuedView(id)!;
}

// Direct starts under way, by workspace: their task rows don't exist until
// createTask gets that far, so they hold their slot here meanwhile.
// On globalThis: the custom server's watcher and the route bundles each load
// their own copy of this module, and must see one set of reservations.
const g = globalThis as unknown as {
  __agentosQueueReserved?: Map<string, number>;
  __agentosQueueTick?: { ticking: Promise<void> | null };
};
const reserved = (g.__agentosQueueReserved ??= new Map<string, number>());

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

const label = queuedLabel;

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
      `SELECT q.*, p.name AS project_name, p.workspace_id AS workspace_id,
         (SELECT COUNT(*) FROM bus_messages b WHERE b.to_id = q.id
            AND b.held_queued = 1 AND b.delivered_at IS NULL AND b.read_at IS NULL) AS held_count
       FROM task_queue q LEFT JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting', 'failed')
       ORDER BY q.position`
    )
    .all() as (QueueRow & {
    project_name: string | null;
    workspace_id: string | null;
    held_count: number;
  })[];
  const places = new Map<string, number>();
  // The score order within each line, by priority and age alone: holds
  // don't move a task's rank.
  const now = Date.now();
  const ranked = new Map<string, { rank: number; of: number }>();
  const lines = new Map<string, typeof rows>();
  for (const r of rows.filter((r) => r.status === "queued")) {
    const key = r.workspace_id ?? `project:${r.project_id}`;
    lines.set(key, [...(lines.get(key) ?? []), r]);
  }
  for (const line of lines.values()) {
    const order = line
      .map((r) => ({ r, score: scoreOf(r, now) }))
      .sort((a, b) => b.score - a.score || a.r.position - b.r.position);
    order.forEach(({ r }, i) =>
      ranked.set(r.id, { rank: i + 1, of: order.length })
    );
  }
  return rows.map((r) => {
    const key = r.workspace_id ?? `project:${r.project_id}`;
    const place = (places.get(key) ?? 0) + 1;
    places.set(key, place);
    const rank = ranked.get(r.id);
    return {
      id: r.id,
      name: label(r),
      prompt: r.prompt,
      projectId: r.project_id,
      projectName: r.project_name,
      workspaceId: r.workspace_id,
      status: r.status,
      position: place,
      after: afterLabel(r),
      afterId: r.after_task,
      note: r.note,
      error: r.error,
      startedBy: r.started_by,
      createdAt: r.created_at,
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      wait: r.wait_code,
      rank: rank?.rank ?? place,
      of: rank?.of ?? place,
      held: r.held_count,
    };
  });
}

function scoreOf(r: QueueRow, now: number): number {
  return scoreParts(
    {
      kind: "start",
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      waitingSinceMs: sqliteMs(r.created_at),
    },
    now
  ).score;
}

// SQLite's datetime('now') is UTC without a zone.
const sqliteMs = (v: string) =>
  Date.parse(v.includes("T") ? v : `${v.replace(" ", "T")}Z`) || 0;

export const queuedView = (id: string) =>
  listQueue().find((q) => q.id === id) ?? null;

// Why an automatic start has to wait, or null. A start now by a person
// isn't held.
function autoHold(workspaceId: string | null, planOnly = false): Hold | null {
  if (workspaceId && isPaused(workspaceId))
    return { code: "orch_paused", text: "Waiting: the orchestrator is paused" };
  if (planOnly) return null;
  const window = brakesEnabled() ? windowRefusal(readUsage()) : null;
  return window ? { code: "window", text: `Waiting: ${window}` } : null;
}

// Whether this machine's load rules out starting a task for this project now.
function loadHeldStart(
  projectId: string,
  prompt: string,
  setting: Need[] | null
): boolean {
  const project = getProject(projectId);
  if (!project || isRemoteHost(project.host_id)) return false;
  const needs =
    setting ??
    needsOf({
      projectId,
      projectPath: expandHome(project.working_directory),
      prompt,
    }).needs;
  const hold = machineHold(
    {
      heavy: heavyNeeds(needs),
      needsUnmet: !meetsNeeds(needs, machineCapabilities()),
      remote: false,
      priority: DEFAULT_PRIORITY,
    },
    localView(),
    Date.now()
  );
  return !!hold && (hold.code === "load_red" || hold.code === "heavy");
}

export type StartOutcome = "started" | "held" | "retry" | "failed";

// Tells the orchestrator that queued it that it started.
function announce(
  r: Pick<QueueRow, "id" | "origin_workspace_id">,
  session: Pick<Session, "name" | "branch_name">,
  placed?: { text: string } | null
): void {
  if (!r.origin_workspace_id) return;
  queueEvent(
    r.origin_workspace_id,
    `queued-start:${r.id}`,
    r.id,
    placed
      ? `Queued task "${session.name}" (id ${r.id.slice(0, 8)}) ${placed.text}.`
      : `Queued task "${session.name}" (id ${r.id.slice(0, 8)}) started on ${session.branch_name ?? "its branch"}.`
  );
}

interface StartOpts {
  force?: boolean;
  // The finish an "after any" start takes (null: none left to take).
  consume?: string | null;
  // Start on this linked machine instead of the project's.
  placement?: Placement | null;
  heavy?: boolean;
}

async function startRow(
  r: QueueRow,
  opts: StartOpts = {}
): Promise<StartOutcome> {
  const project = getProject(r.project_id);
  const workspaceId = project?.workspace_id ?? null;
  const origin = r.origin_workspace_id;
  // The orchestrator starts only in its own workspace's projects on this
  // machine; the project may have moved since it was queued.
  if (
    origin &&
    (!project ||
      workspaceId !== origin ||
      isRemoteHost(r.host_id ?? project.host_id))
  ) {
    patch(r.id, {
      status: "failed",
      error:
        "Not started: its project left the orchestrator's workspace or this machine",
    });
    return "failed";
  }
  if (!opts.force) {
    const held = autoHold(workspaceId, !!r.plan_only);
    if (held) {
      if (r.note !== held.text)
        patch(r.id, { note: held.text, wait_code: held.code });
      return "held";
    }
    // A start that came in during this tick's earlier starts may have taken
    // the slot it planned on. The check and the claim are both synchronous.
    const limit = limitOf(workspaceId);
    if (
      workspaceId &&
      limit !== null &&
      !r.plan_only &&
      runningIn({ workspaceId, projectId: r.project_id }, true).length +
        startingIn(workspaceId) >=
        limit
    )
      return "held";
  }
  let claimed = 0;
  try {
    claimed = db
      .prepare(
        `UPDATE task_queue SET status = 'starting', note = NULL, wait_code = NULL,
           after_any_used = COALESCE(after_any_used, @used)
         WHERE id = @id AND status = 'queued'`
      )
      .run({ id: r.id, used: opts.consume ?? null }).changes;
  } catch (error) {
    // Another waiter took that finish between the plan and the claim.
    if (String(error).includes("UNIQUE")) return "held";
    throw error;
  }
  if (!claimed) return "held";
  const placed = opts.placement ?? null;
  if (!opts.force && !r.plan_only)
    recordAutoStart(placed?.hostId ?? LOCAL, !!opts.heavy, Date.now());
  // A linked machine's start never sees this machine's held messages: they
  // go with the brief it is sent.
  const remote = isRemoteHost(placed?.hostId ?? r.host_id ?? project?.host_id);
  const remoteHeld = remote ? queuedHeldMessages(r.id) : [];
  const task = {
    id: r.id,
    projectId: r.project_id,
    prompt: r.prompt + queuedMessagesSection(remoteHeld),
    name: r.name ?? undefined,
    model: r.model_overrides
      ? (JSON.parse(r.model_overrides) as ModelOverride)
      : (r.model ?? undefined),
    plan: r.plan == null ? undefined : !!r.plan,
    planReason: r.plan_reason,
    planOnly: !!r.plan_only,
    startedBy: r.started_by,
    view: r.view ?? undefined,
    agent: (r.agent_type as AgentType | null) ?? undefined,
    baseBranch: r.base_branch ?? undefined,
    hostId: placed?.hostId ?? r.host_id ?? undefined,
    reclaim: true,
  };
  const placedText = placed
    ? `started on ${placed.name} · ${placed.why}`
    : null;
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
    if (remoteHeld.length) markQueuedHeldDelivered(r.id);
    patch(r.id, {
      status: "started",
      started_at: new Date().toISOString(),
      error: null,
      note: null,
    });
    stampStarted(r, placed);
    announce(r, session, placedText ? { text: placedText } : null);
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
    // The brakes never got to count it: count and announce it here.
    const session = sessionOf(r.id);
    if (session?.task_status) {
      patch(r.id, { status: "started", started_at: new Date().toISOString() });
      if (origin) recordStart(origin, "task", r.id);
      announce(r, session);
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

// Marks the task a queue row became: its priority, and where it was placed.
function stampStarted(r: QueueRow, placed: Placement | null): void {
  const note = placed ? `Started on ${placed.name} · ${placed.why}` : null;
  const priority =
    r.priority && r.priority !== DEFAULT_PRIORITY ? r.priority : null;
  if (!note && !priority) return;
  db.prepare(
    `UPDATE sessions SET priority = COALESCE(?, priority), placed_note = COALESCE(?, placed_note) WHERE id = ?`
  ).run(priority, note, r.id);
}

type QueueRowWithWorkspace = QueueRow & { workspace_id: string | null };

const groupKey = (workspaceId: string | null, projectId: string) =>
  workspaceId ?? `project:${projectId}`;

function groupFor(
  workspaceId: string | null,
  projectId: string,
  startingRows: number
): Group {
  const scope = { workspaceId, projectId };
  return {
    inFlight:
      runningIn(scope, true).length +
      (workspaceId ? (reserved.get(workspaceId) ?? 0) : 0) +
      startingRows,
    limit: limitOf(workspaceId) ?? Number.POSITIVE_INFINITY,
  };
}

// Finishes other waiters have taken, so one finish lets one waiter go.
const usedFinishes = (): string[] =>
  (
    db
      .prepare(
        `SELECT after_any_used AS id FROM task_queue WHERE after_any_used IS NOT NULL`
      )
      .all() as { id: string }[]
  ).map((x) => x.id);

function candidateOf(
  r: QueueRowWithWorkspace,
  used: string[]
): { c: Candidate; needs: Need[] } {
  const project = getProject(r.project_id);
  const hostId = r.host_id ?? project?.host_id;
  const remote = isRemoteHost(hostId);
  const needs = remote
    ? []
    : (parseNeeds(r.machine_needs) ??
      (project
        ? needsOf({
            projectId: project.id,
            projectPath: expandHome(project.working_directory),
            prompt: r.prompt,
          }).needs
        : []));
  let before: Hold | null = null;
  if (r.after_task && !hasFinished(r.after_task))
    before = {
      code: "after",
      text: `After ${afterLabel({ ...r, after_any: null }) ?? "its task"}`,
    };
  let any: Candidate["any"] = null;
  if (r.after_any) {
    const ids = JSON.parse(r.after_any) as string[];
    any = {
      ids,
      finished: ids.filter((id) => !stillWorking(id)),
      used: used.filter((id) => id !== r.after_any_used),
      released: !!r.after_any_used,
      label:
        ids
          .filter(stillWorking)
          .map((id) => sessionOf(id)?.name ?? id.slice(0, 8))
          .join(", ") || "its set",
    };
  }
  return {
    needs,
    c: {
      id: r.id,
      kind: "start",
      group: groupKey(r.workspace_id, r.project_id),
      priority: isPriority(r.priority) ? r.priority : DEFAULT_PRIORITY,
      position: r.position,
      waitingSinceMs: sqliteMs(r.created_at),
      heavy: heavyNeeds(needs),
      needsUnmet: !remote && !meetsNeeds(needs, machineCapabilities()),
      remote,
      planOnly: !!r.plan_only,
      before,
      auto: autoHold(r.workspace_id, !!r.plan_only),
      any,
    },
  };
}

// The linked machines a task could be placed on, with what they report.
async function peerOptions(
  rows: QueueRowWithWorkspace[],
  now: number
): Promise<Map<string, PeerOption[]>> {
  const out = new Map<string, PeerOption[]>();
  const hostIds = [...linkedHostIds()];
  if (!hostIds.length || !rows.length) return out;
  await refreshPeers(hostIds, now);
  // Whether each machine can hold an orchestrator's task (an older AgentOS
  // can't, and would fail its start); unreadable counts as no.
  const holds = new Map<string, boolean>();
  await Promise.all(
    hostIds.map(async (hostId) => {
      const link = hostLink(hostId);
      const caps = link
        ? await hostTasks(link)
            .then((t) => t.capabilities ?? [])
            .catch(() => [])
        : [];
      holds.set(hostId, caps.includes("held-start"));
    })
  );
  const perProject = new Map<string, Record<string, string | null>>();
  for (const r of rows) {
    if (out.has(r.project_id)) continue;
    const project = getProject(r.project_id);
    let can: Record<string, string | null> = {};
    if (project) {
      can =
        perProject.get(project.id) ??
        (await projectMachines(project).catch(() => ({})));
      perProject.set(project.id, can);
    }
    out.set(
      r.project_id,
      hostIds.map((hostId) => {
        const src = peerSource(hostId, now);
        const reading = peerReading(hostId);
        return {
          hostId,
          name: src.label,
          view: viewOf(src, now),
          capabilities: src.capabilities,
          holds: holds.get(hostId) ?? false,
          hasProject: can[hostId] === null,
          loadPerCore: reading ? reading.load1 / reading.cores : 99,
        };
      })
    );
  }
  return out;
}

// One look at the line: every queued task and every paused task that came
// due, scored, held or started. Machine readings come from the monitor and
// the peer poll; the clock is passed in.
export async function tickOnce(now = Date.now()): Promise<"stale" | void> {
  const rows = db
    .prepare(
      `SELECT q.*, p.workspace_id AS workspace_id FROM task_queue q
       JOIN projects p ON p.id = q.project_id
       WHERE q.status IN ('queued', 'starting') ORDER BY q.position`
    )
    .all() as QueueRowWithWorkspace[];
  const resumes = dueResumes();
  if (!rows.length && !resumes.length) return;
  const queued = rows.filter((r) => r.status === "queued");
  const used = usedFinishes();
  const built = new Map(
    queued.map((r) => [r.id, candidateOf(r, used)] as const)
  );
  const candidates: Candidate[] = [...built.values()].map((b) => b.c);
  for (const d of resumes) {
    const workspaceId = workspaceOf(d.projectId);
    candidates.push({
      id: `resume:${d.sessionId}`,
      kind: "resume",
      group: groupKey(workspaceId, d.projectId),
      priority: d.priority,
      position: -1_000_000 + d.pauseId,
      waitingSinceMs: d.dueAtMs,
      heavy: false,
      needsUnmet: false,
      remote: false,
      before: null,
      // A person's timed resume goes ahead of an orchestrator Pause.
      auto: d.byKind === "person" ? null : autoHold(workspaceId),
      any: null,
    });
  }

  // Placement: a start the home machine's load rules out goes to a free
  // linked machine, best score first, one per machine per look.
  const placements = new Map<string, Placement>();
  const home = localView(now);
  const toPlace = candidates.filter(
    (c) =>
      c.kind === "start" &&
      !c.remote &&
      !unplaceable(row(c.id)!) &&
      wantsPlacing(c, home, now)
  );
  if (toPlace.length) {
    const before = lineSignature();
    const peers = await peerOptions(
      toPlace.map((c) => rows.find((r) => r.id === c.id)!),
      now
    );
    // The line moved while the machines were asked: this look is stale, and
    // the one a change during it asks for sees the line as it is now.
    if (lineSignature() !== before) return "stale";
    const taken = new Set<string>();
    for (const c of [...toPlace].sort(
      (a, b) =>
        scoreParts(b, now).score - scoreParts(a, now).score ||
        a.position - b.position
    )) {
      const r = rows.find((x) => x.id === c.id)!;
      const options = (peers.get(r.project_id) ?? []).filter(
        (p) => !taken.has(p.hostId) && (!r.started_by || p.holds !== false)
      );
      const spot = place(c, home, options, built.get(c.id)!.needs, now);
      if (!spot) continue;
      taken.add(spot.hostId);
      placements.set(c.id, spot);
      c.remote = true;
    }
  }

  const groups = new Map<string, Group>();
  for (const c of candidates) {
    if (groups.has(c.group)) continue;
    const r = rows.find(
      (x) => groupKey(x.workspace_id, x.project_id) === c.group
    );
    const projectId =
      r?.project_id ??
      resumes.find((d) => `resume:${d.sessionId}` === c.id)!.projectId;
    const workspaceId = r?.workspace_id ?? workspaceOf(projectId);
    groups.set(
      c.group,
      groupFor(
        workspaceId,
        projectId,
        rows.filter(
          (x) =>
            x.status === "starting" &&
            groupKey(x.workspace_id, x.project_id) === c.group
        ).length
      )
    );
  }

  const plan = planStarts(candidates, groups, home, now);
  for (const r of queued)
    noteWaiting(r, withStayReason(r, plan.explain.get(r.id)));

  for (const id of plan.start) {
    if (id.startsWith("resume:")) {
      await claimResume(id.slice("resume:".length), { reason: "due" });
      continue;
    }
    const r = row(id);
    if (r?.status === "queued")
      await startRow(r, {
        consume: plan.consume.get(id) ?? null,
        placement: placements.get(id) ?? null,
        heavy: built.get(id)?.c.heavy,
      });
  }
}

// Writes why a row waits when that changed: its hold text and code. A bare
// rank isn't stored (the view computes it), so the stream stays quiet.
const MACHINE_HOLDS = new Set<WaitCode>([
  "load_red",
  "load_amber",
  "heavy",
  "needs",
]);

// A hold on this machine's load says, for a task that can't go elsewhere,
// why it waits here instead of starting on a linked machine.
function withStayReason(
  r: QueueRow,
  explain: { code: WaitCode | null; text: string | null } | undefined
) {
  if (!explain?.code || !explain.text || !MACHINE_HOLDS.has(explain.code))
    return explain;
  const why = unplaceable(r);
  return why ? { ...explain, text: `${explain.text} (${why})` } : explain;
}

function noteWaiting(
  r: QueueRow,
  explain: { code: WaitCode | null; text: string | null } | undefined
): void {
  if (!explain) return;
  const hold = explain.code && explain.code !== "slot" ? explain : null;
  if (hold) {
    if (r.note !== hold.text || r.wait_code !== hold.code)
      patch(r.id, { note: hold.text, wait_code: hold.code });
    return;
  }
  // A hold we wrote before is cleared; a brake's note isn't ours to clear.
  if (r.wait_code && r.wait_code !== "slot")
    patch(r.id, { note: null, wait_code: explain.code });
  else if (r.wait_code !== explain.code)
    patch(r.id, { wait_code: explain.code });
}

function lineSignature(): string {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p,
              COALESCE(SUM(priority = 'normal'), 0) AS pr,
              (SELECT COUNT(*) FROM sessions WHERE task_status IS NOT NULL
                 AND task_status NOT IN ('merged', 'dropped')) AS running
       FROM task_queue WHERE status IN ('queued', 'starting')`
    )
    .get() as { n: number; p: number; pr: number; running: number };
  return `${r.n}:${r.p}:${r.pr}:${r.running}`;
}

// One look at a time; a call during one shares it, and a look that went
// stale (the line changed while it waited on a machine) is run again.
const tickState = (g.__agentosQueueTick ??= { ticking: null });

export function tickQueue(): Promise<void> {
  tickState.ticking ??= (async () => {
    try {
      for (let i = 0; i < 3; i++) {
        if ((await tickOnce()) !== "stale") break;
      }
    } finally {
      tickState.ticking = null;
    }
  })();
  return tickState.ticking;
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

// A task still waiting in the line (or failed to start) by id, an id prefix
// of 4+ characters or, when asked, its name; in one workspace.
export function findQueued(
  workspaceId: string,
  ref: string,
  opts: { byName?: boolean } = {}
): QueueRow | null {
  const want = ref.trim();
  const rows = db
    .prepare(
      `SELECT q.* FROM task_queue q JOIN projects p ON p.id = q.project_id
       WHERE p.workspace_id = ? AND q.status IN ('queued', 'failed')`
    )
    .all(workspaceId) as QueueRow[];
  const lower = want.toLowerCase();
  const hits = rows.filter(
    (r) =>
      r.id === want ||
      (want.length >= 4 && r.id.startsWith(want)) ||
      (opts.byName && label(r).toLowerCase() === lower)
  );
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches ${hits.length} queued tasks: ${hits.map((h) => `${label(h)} (${h.id.slice(0, 8)})`).join(", ")}`
    );
  return hits[0] ?? null;
}

export { queuedLabel };

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
