import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { isPaused } from "../orchestrator/pause";
import {
  cronError,
  DEFAULT_TIMEZONE,
  isTimezone,
  MESSAGE_MIN_GAP_MINUTES,
  MIN_GAP_MINUTES,
  minGapMinutes,
} from "./cron";

export const SCHEDULE_KINDS = [
  "task",
  "session",
  "orchestrator",
  "message",
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export type RunTrigger = "schedule" | "catch-up" | "manual";
// "claimed" only between taking a slot and starting its work.
export type RunOutcome = "claimed" | "started" | "skipped" | "failed";

export interface Schedule {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  kind: ScheduleKind;
  // A "message" schedule's session. Its id is the address; its name is
  // only looked up to show.
  target_session_id: string | null;
  // The agent session that made it (aos schedule add), or null for Saad.
  created_by_session_id: string | null;
  enabled: boolean;
  // Epoch ms: only slots after this run (set on create, enable, cron edit).
  armed_at: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRun {
  id: number;
  schedule_id: string;
  // The slot's ISO time, or manual:<id> for Run now.
  slot: string;
  slot_at: number;
  trigger: RunTrigger;
  outcome: RunOutcome;
  detail: string | null;
  session_id: string | null;
  created_at: string;
}

export interface ScheduleInput {
  workspaceId: string;
  projectId?: string | null;
  name: string;
  cron: string;
  timezone?: string;
  prompt: string;
  kind: ScheduleKind;
  targetSessionId?: string | null;
  // Set once, at create: an agent made it.
  createdBySessionId?: string | null;
  enabled?: boolean;
}

type Row = Omit<Schedule, "enabled"> & { enabled: number };
const toSchedule = (r: Row): Schedule => ({ ...r, enabled: !!r.enabled });

export function listSchedules(workspaceId?: string | null): Schedule[] {
  const rows = (
    workspaceId
      ? db
          .prepare(
            `SELECT * FROM schedules WHERE archived_at IS NULL AND workspace_id = ? ORDER BY created_at`
          )
          .all(workspaceId)
      : db
          .prepare(
            `SELECT * FROM schedules WHERE archived_at IS NULL ORDER BY created_at`
          )
          .all()
  ) as Row[];
  return rows.map(toSchedule);
}

export function getSchedule(id: string): Schedule | null {
  const row = db.prepare(`SELECT * FROM schedules WHERE id = ?`).get(id) as
    | Row
    | undefined;
  return row ? toSchedule(row) : null;
}

// By id, id prefix or name (case-insensitive), among live schedules.
export function findSchedule(ref: string): Schedule {
  const r = ref.trim();
  const live = listSchedules();
  const byId = live.filter(
    (s) => s.id === r || (r.length >= 6 && s.id.startsWith(r))
  );
  const matches = byId.length
    ? byId
    : live.filter((s) => s.name.toLowerCase() === r.toLowerCase());
  if (matches.length === 1) return matches[0];
  throw new Error(
    matches.length
      ? `"${ref}" matches several schedules; use its id`
      : `No schedule called "${ref}"`
  );
}

export function getSessionRow(id: string): Session | null {
  return (
    (db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | Session
      | undefined) ?? null
  );
}

// The workspace a session belongs to: an orchestrator's own, or its
// project's.
export function sessionWorkspace(session: Session): string | null {
  if (session.workspace_id) return session.workspace_id;
  return session.project_id
    ? (getProject(session.project_id)?.workspace_id ?? null)
    : null;
}

// Why a session can't take a scheduled message, or null.
export function sessionTargetProblem(
  sessionId: string | null,
  workspaceId: string
): string | null {
  if (!sessionId) return "Pick a session to message";
  const session = getSessionRow(sessionId);
  if (!session) return "session no longer exists";
  if (session.archived_at) return "session archived";
  if (session.role === "orchestrator")
    return "the orchestrator takes orchestrator schedules, not messages";
  if (session.task_status && session.task_status !== "running")
    return "session finished";
  if (sessionWorkspace(session) !== workspaceId)
    return `${session.name} isn't in this schedule's workspace`;
  return null;
}

function validate(
  input: ScheduleInput,
  selfId?: string
): Required<Omit<ScheduleInput, "createdBySessionId">> {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the schedule a name");
  if (name.length > 80) throw new Error("Keep the name under 80 characters");
  // It's quoted inside the scheduled message's label.
  if (/["[\]\n]/.test(name))
    throw new Error("A schedule name can't use quotes or [ ]");
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error("Write the prompt it runs");
  if (!SCHEDULE_KINDS.includes(input.kind))
    throw new Error("Pick task, session, orchestrator or message");
  const cron = input.cron?.trim().replace(/\s+/g, " ");
  const bad = cronError(cron ?? "");
  if (bad) throw new Error(bad);
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  if (!isTimezone(timezone)) throw new Error(`Unknown time zone "${timezone}"`);
  if (!getWorkspace(input.workspaceId)) throw new Error("Pick a workspace");
  const message = input.kind === "message";
  // A message goes to a session, whatever project it's in.
  const projectId = message ? null : input.projectId || null;
  const targetSessionId = message ? input.targetSessionId || null : null;
  if (message) {
    const problem = sessionTargetProblem(targetSessionId, input.workspaceId);
    if (problem)
      throw new Error(
        problem === "Pick a session to message"
          ? problem
          : `Can't message that session: ${problem}`
      );
  }
  if (projectId) {
    const project = getProject(projectId);
    if (!project || project.is_uncategorized) throw new Error("Pick a project");
    if (project.workspace_id !== input.workspaceId)
      throw new Error(`${project.name} isn't in this workspace`);
    if (project.host_id && project.host_id !== "local")
      throw new Error("Schedules run on this machine's projects only");
  } else if (input.kind === "task" || input.kind === "session") {
    throw new Error("A task or session schedule needs a project");
  }
  if (
    (input.kind === "task" || input.kind === "session") &&
    minGapMinutes(cron, timezone) < MIN_GAP_MINUTES
  )
    throw new Error(
      "A task or session schedule runs at most once an hour; for more often, post to the orchestrator"
    );
  if (message && minGapMinutes(cron, timezone) < MESSAGE_MIN_GAP_MINUTES)
    throw new Error(
      `A message schedule runs at most every ${MESSAGE_MIN_GAP_MINUTES} minutes`
    );
  const clash = listSchedules(input.workspaceId).find(
    (s) => s.id !== selfId && s.name.toLowerCase() === name.toLowerCase()
  );
  if (clash)
    throw new Error(`There's already a schedule called "${clash.name}"`);
  return {
    workspaceId: input.workspaceId,
    projectId,
    name,
    cron,
    timezone,
    prompt,
    kind: input.kind,
    targetSessionId,
    enabled: input.enabled ?? true,
  };
}

export function createSchedule(
  input: ScheduleInput,
  now = Date.now()
): Schedule {
  const v = validate(input);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO schedules (id, workspace_id, project_id, name, cron, timezone, prompt, kind, target_session_id, created_by_session_id, enabled, armed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    v.workspaceId,
    v.projectId,
    v.name,
    v.cron,
    v.timezone,
    v.prompt,
    v.kind,
    v.targetSessionId,
    input.createdBySessionId ?? null,
    v.enabled ? 1 : 0,
    now
  );
  return getSchedule(id)!;
}

export function updateSchedule(
  id: string,
  patch: Partial<ScheduleInput>,
  now = Date.now()
): Schedule {
  const current = getSchedule(id);
  if (!current || current.archived_at) throw new Error("Schedule not found");
  const v = validate(
    {
      workspaceId: patch.workspaceId ?? current.workspace_id,
      projectId:
        patch.projectId === undefined ? current.project_id : patch.projectId,
      name: patch.name ?? current.name,
      cron: patch.cron ?? current.cron,
      timezone: patch.timezone ?? current.timezone,
      prompt: patch.prompt ?? current.prompt,
      kind: patch.kind ?? current.kind,
      targetSessionId:
        patch.targetSessionId === undefined
          ? current.target_session_id
          : patch.targetSessionId,
      enabled: patch.enabled ?? current.enabled,
    },
    id
  );
  // A new time or a fresh enable starts counting from now: no slot from
  // before it is "missed".
  const rearm =
    v.cron !== current.cron ||
    v.timezone !== current.timezone ||
    (v.enabled && !current.enabled);
  db.prepare(
    `UPDATE schedules SET workspace_id = ?, project_id = ?, name = ?, cron = ?, timezone = ?,
       prompt = ?, kind = ?, target_session_id = ?, enabled = ?, armed_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    v.workspaceId,
    v.projectId,
    v.name,
    v.cron,
    v.timezone,
    v.prompt,
    v.kind,
    v.targetSessionId,
    v.enabled ? 1 : 0,
    rearm ? now : current.armed_at,
    id
  );
  return getSchedule(id)!;
}

// Removed from the list; its runs stay.
export function archiveSchedule(id: string): void {
  db.prepare(
    `UPDATE schedules SET archived_at = datetime('now'), enabled = 0 WHERE id = ? AND archived_at IS NULL`
  ).run(id);
}

// A braked run keeps its row under this key, so its slot stays due.
const brakedKey = (slot: string) => `braked:${slot}`;

// Takes a slot, or returns null when it's already taken: the row is the lock.
// A slot the brakes held takes its own row back, so retrying it each tick
// leaves one row, not one a minute.
export function claimSlot(
  scheduleId: string,
  slot: string,
  slotAt: number,
  trigger: RunTrigger
): number | null {
  const held = db
    .prepare(
      `SELECT id FROM schedule_runs WHERE schedule_id = ? AND slot = ? AND outcome = 'skipped'`
    )
    .get(scheduleId, brakedKey(slot)) as { id: number } | undefined;
  if (held) {
    try {
      const res = db
        .prepare(
          `UPDATE schedule_runs SET slot = ?, outcome = 'claimed', trigger = ?, detail = NULL
           WHERE id = ? AND slot = ?`
        )
        .run(slot, trigger, held.id, brakedKey(slot));
      return res.changes === 1 ? held.id : null;
    } catch (error) {
      // Someone claimed the slot itself meanwhile.
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
        return null;
      throw error;
    }
  }
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO schedule_runs (schedule_id, slot, slot_at, trigger, outcome)
       VALUES (?, ?, ?, ?, 'claimed')`
    )
    .run(scheduleId, slot, slotAt, trigger);
  return res.changes === 1 ? Number(res.lastInsertRowid) : null;
}

export function finishRun(
  runId: number,
  outcome: Exclude<RunOutcome, "claimed">,
  detail: string | null = null,
  sessionId: string | null = null
): void {
  db.prepare(
    `UPDATE schedule_runs SET outcome = ?, detail = ?, session_id = COALESCE(?, session_id) WHERE id = ?`
  ).run(outcome, detail?.slice(0, 500) ?? null, sessionId, runId);
}

export function slotTaken(scheduleId: string, slot: string): boolean {
  return !!db
    .prepare(`SELECT 1 FROM schedule_runs WHERE schedule_id = ? AND slot = ?`)
    .get(scheduleId, slot);
}

export function listRuns(scheduleId: string, limit = 50): ScheduleRun[] {
  return db
    .prepare(
      `SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(scheduleId, limit) as ScheduleRun[];
}

export function lastRun(scheduleId: string): ScheduleRun | null {
  return (listRuns(scheduleId, 1)[0] as ScheduleRun | undefined) ?? null;
}

// The newest run that started something, before this one.
export function lastStarted(
  scheduleId: string,
  beforeId: number
): ScheduleRun | null {
  return (
    (db
      .prepare(
        `SELECT * FROM schedule_runs WHERE schedule_id = ? AND id < ? AND outcome = 'started'
           AND session_id IS NOT NULL ORDER BY id DESC LIMIT 1`
      )
      .get(scheduleId, beforeId) as ScheduleRun | undefined) ?? null
  );
}

// A claimed run the brakes held: skipped with why, its slot freed to retry.
export function brakeRun(runId: number, detail: string): void {
  db.prepare(
    `UPDATE schedule_runs SET outcome = 'skipped', detail = ?, slot = 'braked:' || slot
     WHERE id = ? AND outcome = 'claimed'`
  ).run(detail.slice(0, 500), runId);
}

// Links a claimed run to the session it's starting, the moment it exists.
export function attachSession(runId: number, sessionId: string): void {
  db.prepare(
    `UPDATE schedule_runs SET session_id = ? WHERE id = ? AND outcome = 'claimed'`
  ).run(sessionId, runId);
}

// The newest run before this one that started or failed: whether the
// schedule is in a failing streak, whatever it skipped in between.
export function lastSettledBefore(
  scheduleId: string,
  beforeId: number
): ScheduleRun | null {
  return (
    (db
      .prepare(
        `SELECT * FROM schedule_runs WHERE schedule_id = ? AND id < ?
           AND outcome IN ('started', 'failed') ORDER BY id DESC LIMIT 1`
      )
      .get(scheduleId, beforeId) as ScheduleRun | undefined) ?? null
  );
}

// Why a schedule can't run where it points now, or null. Checked at each
// run: a project can move workspace, and a workspace can be deleted, after
// the schedule was saved.
export function targetProblem(schedule: Schedule): string | null {
  if (!getWorkspace(schedule.workspace_id))
    return "Its workspace no longer exists";
  if (schedule.kind === "message")
    return sessionTargetProblem(
      schedule.target_session_id,
      schedule.workspace_id
    );
  if (!schedule.project_id) return null;
  const project = getProject(schedule.project_id);
  if (!project) return "Its project no longer exists";
  if (project.workspace_id !== schedule.workspace_id)
    return `${project.name} moved out of this schedule's workspace; edit the schedule`;
  return null;
}

// Every session this schedule's runs started, newest first.
export function startedSessions(scheduleId: string): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT session_id FROM schedule_runs
         WHERE schedule_id = ? AND outcome = 'started' AND session_id IS NOT NULL
         ORDER BY id DESC`
      )
      .all(scheduleId) as { session_id: string }[]
  ).map((r) => r.session_id);
}

export const LEASE_MS = 3 * 60 * 1000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

// Takes or renews the right to tick schedules. Only one process holds it:
// another may take it once the holder's heartbeat is stale or its process
// is gone.
export function holdLease(
  owner: string,
  pid = process.pid,
  now = Date.now()
): boolean {
  db.prepare(
    `INSERT OR IGNORE INTO scheduler_lease (id, owner, pid, heartbeat) VALUES (1, ?, ?, ?)`
  ).run(owner, pid, now);
  const row = db
    .prepare(`SELECT owner, pid, heartbeat FROM scheduler_lease WHERE id = 1`)
    .get() as { owner: string; pid: number; heartbeat: number };
  const free =
    row.owner === owner ||
    row.heartbeat < now - LEASE_MS ||
    (row.pid !== pid && !alive(row.pid));
  if (!free) return false;
  return (
    db
      .prepare(
        `UPDATE scheduler_lease SET owner = ?, pid = ?, heartbeat = ?
         WHERE id = 1 AND owner = ? AND heartbeat = ?`
      )
      .run(owner, pid, now, row.owner, row.heartbeat).changes === 1
  );
}

export const pausedFor = (schedule: Schedule): boolean =>
  isPaused(schedule.workspace_id);

// Slots the last process left claimed. One that had already started its
// session counts as started, so the overlap check still sees that session;
// one that hadn't is recorded as failed.
export function failAbandonedClaims(
  olderThanMs: number,
  now = Date.now()
): number {
  const before = Math.floor((now - olderThanMs) / 1000);
  const started = db
    .prepare(
      `UPDATE schedule_runs SET outcome = 'started', detail = 'AgentOS restarted while it was starting'
       WHERE outcome = 'claimed' AND session_id IS NOT NULL AND created_at < datetime(?, 'unixepoch')`
    )
    .run(before).changes;
  return (
    started +
    db
      .prepare(
        `UPDATE schedule_runs SET outcome = 'failed', detail = 'interrupted: AgentOS stopped while it was starting'
         WHERE outcome = 'claimed' AND created_at < datetime(?, 'unixepoch')`
      )
      .run(before).changes
  );
}
