/**
 * Schedules: a cron time that starts agent work without anyone opening
 * AgentOS. Each one runs a prompt as a task (ends in a PR), a chat session
 * (stays open), or a message to its workspace's orchestrator. Pausing that
 * orchestrator pauses the workspace's schedules too.
 */

import { getProject } from "../projects";
import { resolveSession } from "../bus";
import {
  cronError,
  DEFAULT_TIMEZONE,
  describeCron,
  everyCron,
  isTimezone,
  MESSAGE_MIN_GAP_MINUTES,
  minGapMinutes,
} from "./cron";
import { runSlot, type RunDeps, type RunResult } from "./run";
import { nextRunAt } from "./scheduler";
import { realDeps } from "./start";
import {
  getSessionRow,
  sessionWorkspace,
  getSchedule,
  lastRun,
  listRuns,
  listSchedules,
  type Schedule,
  type ScheduleInput,
  type ScheduleRun,
} from "./store";
import { isPaused } from "../orchestrator/pause";

export * from "./store";
export { schedulesEnabled, startScheduler, tick } from "./scheduler";
export { realDeps } from "./start";

export interface ScheduleView extends Schedule {
  description: string;
  projectName: string | null;
  // A message schedule's session, by its name now.
  targetName: string | null;
  nextRunAt: number | null;
  lastRun: ScheduleRun | null;
  // Its workspace's orchestrator is paused, so it skips its slots.
  paused: boolean;
}

export function scheduleView(s: Schedule, now = Date.now()): ScheduleView {
  return {
    ...s,
    description: describeCron(s.cron),
    projectName: s.project_id ? (getProject(s.project_id)?.name ?? null) : null,
    targetName: s.target_session_id
      ? (getSessionRow(s.target_session_id)?.name ?? null)
      : null,
    nextRunAt: nextRunAt(s, now),
    lastRun: lastRun(s.id),
    paused: isPaused(s.workspace_id),
  };
}

export function listScheduleViews(workspaceId?: string | null): ScheduleView[] {
  return listSchedules(workspaceId).map((s) => scheduleView(s));
}

// `aos schedule add --session <ref> --every 30m "<prompt>"`: the session by
// any name aos send takes, stored by id, in that session's workspace.
export function checkInInput(opts: {
  session: string;
  // The agent session asking, from `aos`; null for Saad.
  from?: string | null;
  every?: string;
  cron?: string;
  prompt: string;
  name?: string;
  timezone?: string;
}): ScheduleInput {
  const session = resolveSession(opts.session);
  const workspaceId = sessionWorkspace(session);
  if (!workspaceId) throw new Error(`${session.name} isn't in a workspace`);
  // An agent schedules only inside its own workspace.
  if (opts.from) {
    const creator = getSessionRow(opts.from);
    if (!creator) throw new Error("Unknown sender session");
    if (sessionWorkspace(creator) !== workspaceId)
      throw new Error(`${session.name} isn't in your workspace`);
  }
  const cron = opts.cron?.trim() || everyCron(opts.every ?? "30m");
  // The workspace's orchestrator is kept as "its orchestrator", not this
  // session's id: each run goes to whichever session is orchestrator then.
  // Held to a message's limit: createSchedule checks the rest.
  const orchestrator = session.role === "orchestrator";
  const tz = opts.timezone?.trim() || DEFAULT_TIMEZONE;
  if (
    orchestrator &&
    !cronError(cron) &&
    isTimezone(tz) &&
    minGapMinutes(cron, tz) < MESSAGE_MIN_GAP_MINUTES
  )
    throw new Error(
      `A message schedule runs at most every ${MESSAGE_MIN_GAP_MINUTES} minutes`
    );
  return {
    workspaceId,
    name: opts.name?.trim() || `Check-in: ${session.name}`.slice(0, 80),
    cron,
    timezone: opts.timezone,
    prompt: opts.prompt,
    kind: orchestrator ? "orchestrator" : "message",
    targetSessionId: orchestrator ? null : session.id,
    createdBySessionId: opts.from || null,
  };
}

export function scheduleHistory(id: string, limit = 50): ScheduleRun[] {
  return listRuns(id, limit);
}

// Run now: its own slot, whatever the time and while the last run is still
// working. Pause holds it like any run.
export async function runNow(
  id: string,
  deps: RunDeps = realDeps
): Promise<RunResult> {
  const schedule = getSchedule(id);
  if (!schedule || schedule.archived_at) throw new Error("Schedule not found");
  const result = await runSlot(schedule, Date.now(), "manual", deps);
  if (!result) throw new Error("Couldn't claim a run");
  return result;
}
