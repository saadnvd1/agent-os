import { randomUUID } from "crypto";
import { db } from "../db";
import { getProject } from "../projects";
import { getWorkspace } from "../workspaces";
import { cronError, DEFAULT_TIMEZONE, isTimezone } from "./cron";

export const SCHEDULE_KINDS = ["task", "session", "orchestrator"] as const;
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

function validate(
  input: ScheduleInput,
  selfId?: string
): Required<ScheduleInput> {
  const name = input.name?.trim();
  if (!name) throw new Error("Give the schedule a name");
  if (name.length > 80) throw new Error("Keep the name under 80 characters");
  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error("Write the prompt it runs");
  if (!SCHEDULE_KINDS.includes(input.kind))
    throw new Error("Pick task, session or orchestrator");
  const cron = input.cron?.trim().replace(/\s+/g, " ");
  const bad = cronError(cron ?? "");
  if (bad) throw new Error(bad);
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  if (!isTimezone(timezone)) throw new Error(`Unknown time zone "${timezone}"`);
  if (!getWorkspace(input.workspaceId)) throw new Error("Pick a workspace");
  const projectId = input.projectId || null;
  if (projectId) {
    const project = getProject(projectId);
    if (!project || project.is_uncategorized) throw new Error("Pick a project");
    if (project.workspace_id !== input.workspaceId)
      throw new Error(`${project.name} isn't in this workspace`);
    if (project.host_id && project.host_id !== "local")
      throw new Error("Schedules run on this machine's projects only");
  } else if (input.kind !== "orchestrator") {
    throw new Error("A task or session schedule needs a project");
  }
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
    `INSERT INTO schedules (id, workspace_id, project_id, name, cron, timezone, prompt, kind, enabled, armed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    v.workspaceId,
    v.projectId,
    v.name,
    v.cron,
    v.timezone,
    v.prompt,
    v.kind,
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
       prompt = ?, kind = ?, enabled = ?, armed_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    v.workspaceId,
    v.projectId,
    v.name,
    v.cron,
    v.timezone,
    v.prompt,
    v.kind,
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

// Takes a slot, or returns null when it's already taken: the row is the lock.
export function claimSlot(
  scheduleId: string,
  slot: string,
  slotAt: number,
  trigger: RunTrigger
): number | null {
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
    `UPDATE schedule_runs SET outcome = ?, detail = ?, session_id = ? WHERE id = ?`
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

// Slots a crash left claimed but never started: recorded as failed.
export function failAbandonedClaims(
  olderThanMs: number,
  now = Date.now()
): number {
  return db
    .prepare(
      `UPDATE schedule_runs SET outcome = 'failed', detail = 'interrupted: AgentOS stopped while it was starting'
       WHERE outcome = 'claimed' AND created_at < datetime(?, 'unixepoch')`
    )
    .run(Math.floor((now - olderThanMs) / 1000)).changes;
}
