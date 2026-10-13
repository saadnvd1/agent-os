/**
 * Schedules: a cron time that starts agent work without anyone opening
 * AgentOS. Each one runs a prompt as a task (ends in a PR), a chat session
 * (stays open), or a message to its workspace's orchestrator. Pausing that
 * orchestrator pauses the workspace's schedules too.
 */

import { getProject } from "../projects";
import { resolveSession } from "../bus";
import {
  DEFAULT_TIMEZONE,
  describeCron,
  everyCron,
  formatRunTime,
} from "./cron";
import { parseWhen } from "./when";
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
  oneOff: boolean;
  // Who made it: Saad, or the agent session (the orchestrator, or another).
  createdBy: { kind: "saad" | "orchestrator" | "session"; name: string };
}

function creatorOf(s: Schedule): ScheduleView["createdBy"] {
  const creator = s.created_by_session_id
    ? getSessionRow(s.created_by_session_id)
    : null;
  if (!creator) return { kind: "saad", name: "Saad" };
  return creator.role === "orchestrator"
    ? { kind: "orchestrator", name: "Orchestrator" }
    : { kind: "session", name: creator.name };
}

export function scheduleView(s: Schedule, now = Date.now()): ScheduleView {
  return {
    ...s,
    description:
      s.run_at != null
        ? `Once, ${formatRunTime(s.run_at, s.timezone)}`
        : describeCron(s.cron),
    projectName: s.project_id ? (getProject(s.project_id)?.name ?? null) : null,
    targetName: s.target_session_id
      ? (getSessionRow(s.target_session_id)?.name ?? null)
      : null,
    nextRunAt: nextRunAt(s, now),
    lastRun: lastRun(s.id),
    paused: isPaused(s.workspace_id),
    oneOff: s.run_at != null,
    createdBy: creatorOf(s),
  };
}

export function listScheduleViews(workspaceId?: string | null): ScheduleView[] {
  // A recipe's timer shows on the recipe, not in this list.
  return listSchedules(workspaceId)
    .filter((s) => s.kind !== "recipe")
    .map((s) => scheduleView(s));
}

// `aos schedule add --session <ref> --every 30m "<prompt>"`: the session by
// any name aos send takes, stored by id, in that session's workspace.
export function checkInInput(opts: {
  session: string;
  // The agent session asking, from `aos`; null for Saad.
  from?: string | null;
  every?: string;
  cron?: string;
  // A one-off instead of a cron: "tomorrow 10am", "in 2h", an ISO time.
  at?: string;
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
  if (opts.at && (opts.cron || opts.every))
    throw new Error("Give a run time (at) or a repeat (every, cron), not both");
  const tz = opts.timezone?.trim() || DEFAULT_TIMEZONE;
  const runAt = opts.at ? parseWhen(opts.at, tz) : null;
  const cron =
    runAt === null
      ? opts.cron?.trim() || everyCron(opts.every ?? "30m")
      : undefined;
  // The workspace's orchestrator is kept as "its orchestrator", not this
  // session's id: each run goes to whichever session is orchestrator then.
  const orchestrator = session.role === "orchestrator";
  return {
    workspaceId,
    name:
      opts.name?.trim() ||
      (runAt === null
        ? `Check-in: ${session.name}`.slice(0, 80)
        : reminderName(workspaceId, runAt, tz)),
    cron,
    at: runAt,
    timezone: opts.timezone,
    prompt: opts.prompt,
    kind: orchestrator ? "orchestrator" : "message",
    targetSessionId: orchestrator ? null : session.id,
    createdBySessionId: opts.from || null,
  };
}

// "Reminder Tue, Oct 7, 9:00 AM", with a number after it when that's taken.
export function reminderName(
  workspaceId: string,
  runAt: number,
  tz = DEFAULT_TIMEZONE
): string {
  const taken = new Set(
    listSchedules(workspaceId)
      .filter((s) => !s.done_at)
      .map((s) => s.name.toLowerCase())
  );
  const base = `Reminder ${formatRunTime(runAt, tz)}`;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  return name;
}

export function scheduleHistory(id: string, limit = 50): ScheduleRun[] {
  return listRuns(id, limit);
}

// Run now: its own slot, whatever the time and while the last run is still
// working. Pause holds it like any run. A one-off has one slot, so Run now
// uses up its only run.
export async function runNow(
  id: string,
  deps: RunDeps = realDeps
): Promise<RunResult> {
  const schedule = getSchedule(id);
  if (!schedule || schedule.archived_at) throw new Error("Schedule not found");
  const result = await runSlot(schedule, Date.now(), "manual", deps);
  if (!result)
    throw new Error(
      schedule.run_at != null
        ? "It already ran: edit it to a new time to run it again"
        : "Couldn't claim a run"
    );
  return result;
}
