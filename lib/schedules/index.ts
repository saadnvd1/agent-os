/**
 * Schedules: a cron time that starts agent work without anyone opening
 * AgentOS. Each one runs a prompt as a task (ends in a PR), a chat session
 * (stays open), or a message to its workspace's orchestrator. Pausing that
 * orchestrator pauses the workspace's schedules too.
 */

import { getProject } from "../projects";
import { describeCron } from "./cron";
import { runSlot, type RunDeps, type RunResult } from "./run";
import { nextRunAt } from "./scheduler";
import { realDeps } from "./start";
import {
  getSchedule,
  lastRun,
  listRuns,
  listSchedules,
  type Schedule,
  type ScheduleRun,
} from "./store";
import { isPaused } from "../orchestrator/pause";

export * from "./store";
export { startScheduler, tick } from "./scheduler";
export { realDeps } from "./start";

export interface ScheduleView extends Schedule {
  description: string;
  projectName: string | null;
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
    nextRunAt: nextRunAt(s, now),
    lastRun: lastRun(s.id),
    paused: isPaused(s.workspace_id),
  };
}

export function listScheduleViews(workspaceId?: string | null): ScheduleView[] {
  return listSchedules(workspaceId).map((s) => scheduleView(s));
}

export function scheduleHistory(id: string, limit = 50): ScheduleRun[] {
  return listRuns(id, limit);
}

// Run now: its own slot, whatever the time, pause or the last run.
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
