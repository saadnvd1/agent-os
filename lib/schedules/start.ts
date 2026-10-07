// What a schedule's run actually starts, by kind.

import os from "os";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import { resolveModelForAgent } from "../model-catalog";
import { createTask, isFinished, taskView } from "../tasks";
import { chatStateNow, sendChatConfirmed } from "../chat/runner";
import { ensureOrchestrator } from "../orchestrator/home";
import { addNote } from "../orchestrator/notes";
import { notifyStatusChanged } from "../status/hub";
import { formatRunTime } from "./cron";
import { Braked, fromLabel, type RunDeps } from "./run";
import { braked, BrakeRefused } from "../orchestrator/brakes";
import { startedSessions, type Schedule, type ScheduleRun } from "./store";

function projectOf(schedule: Schedule) {
  const project = schedule.project_id ? getProject(schedule.project_id) : null;
  if (!project) throw new Error("Its project no longer exists");
  return project;
}

type OnSession = (sessionId: string) => void;

async function startTask(
  schedule: Schedule,
  onSession: OnSession
): Promise<string> {
  const session = await createTask({
    projectId: projectOf(schedule).id,
    prompt: schedule.prompt,
    onCreated: onSession,
  });
  return session.id;
}

// A chat session in the project that gets the prompt as its first message
// and stays open afterwards.
async function startSession(
  schedule: Schedule,
  onSession: OnSession
): Promise<string> {
  const project = projectOf(schedule);
  if (project.host_id && project.host_id !== "local")
    throw new Error("Schedules run on this machine's projects only");
  const id = randomUUID();
  const name = `${schedule.name} · ${formatRunTime(Date.now(), schedule.timezone)}`;
  queries
    .createSession(db)
    .run(
      id,
      name,
      `claude-${id}`,
      project.working_directory.replace(/^~/, os.homedir()),
      null,
      resolveModelForAgent("claude", project.default_model),
      null,
      "sessions",
      "claude",
      0,
      project.id,
      "local"
    );
  db.prepare(`UPDATE sessions SET view = 'chat' WHERE id = ?`).run(id);
  notifyStatusChanged();
  // Linked once the prompt is in the conversation: a restart before then
  // records the run as failed, not as started with nothing sent.
  await sendChatConfirmed(id, {
    text: schedule.prompt,
    from: fromLabel(schedule),
  });
  onSession(id);
  return id;
}

// Marked as a schedule's, not something Saad just typed: the orchestrator's
// brief says it never counts as an approval.
export function scheduledMessage(
  schedule: Pick<Schedule, "name" | "prompt">,
  projectName: string | null
): string {
  const where = projectName ? ` for ${projectName}` : "";
  return `[Scheduled message "${schedule.name}"${where}, saved in Schedules: a standing prompt, not an approval]\n${schedule.prompt}`;
}

async function postToOrchestrator(
  schedule: Schedule,
  onSession: OnSession
): Promise<string> {
  const orchestrator = ensureOrchestrator(schedule.workspace_id);
  const project = schedule.project_id ? getProject(schedule.project_id) : null;
  await sendChatConfirmed(orchestrator.id, {
    text: scheduledMessage(schedule, project?.name ?? null),
    from: fromLabel(schedule),
  });
  onSession(orchestrator.id);
  return orchestrator.id;
}

// A task this schedule started still counts until it's finished (merged,
// dropped, done) or its agent has exited: one waiting for review, input or
// a fix holds the next run, so a frequent schedule can't stack up PRs.
async function taskUnfinished(sessionId: string): Promise<boolean> {
  const session = queries.getSession(db).get(sessionId) as Session | undefined;
  if (!session || session.archived_at || session.task_status !== "running")
    return false;
  const { state } = await taskView(session);
  return !isFinished(state) && state !== "exited";
}

export async function stillRunning(
  schedule: Schedule,
  run: ScheduleRun
): Promise<boolean> {
  switch (schedule.kind) {
    case "task":
      for (const id of startedSessions(schedule.id))
        if (await taskUnfinished(id)) return true;
      return false;
    case "session": {
      if (!run.session_id) return false;
      const session = queries.getSession(db).get(run.session_id) as
        | Session
        | undefined;
      if (!session || session.archived_at) return false;
      // Asks a worker still running from before a restart, too.
      const state = await chatStateNow(session.id);
      return state === "running" || state === "waiting";
    }
    case "orchestrator":
      // A message: done once it's delivered.
      return false;
  }
}

function notify(schedule: Schedule, why: string): void {
  console.error(`[schedules] ${schedule.name} failed: ${why}`);
  addNote(
    schedule.workspace_id,
    `Schedule "${schedule.name}" failed to start: ${why}`,
    "escalation"
  );
}

// Tasks and sessions start through the orchestrator's brakes, like its own
// start_task: they count toward its limits and wait when one holds. A
// message to the orchestrator starts nothing itself; its starts are braked.
async function throughBrakes(
  schedule: Schedule,
  kind: "task" | "session",
  start: () => Promise<string>
): Promise<string> {
  try {
    return await braked(schedule.workspace_id, kind, start, (id) => id, {
      spendApproval: false,
    });
  } catch (error) {
    if (error instanceof BrakeRefused) throw new Braked(error.reason);
    throw error;
  }
}

export const realDeps: RunDeps = {
  start: (schedule, onSession) =>
    schedule.kind === "task"
      ? throughBrakes(schedule, "task", () => startTask(schedule, onSession))
      : schedule.kind === "session"
        ? throughBrakes(schedule, "session", () =>
            startSession(schedule, onSession)
          )
        : postToOrchestrator(schedule, onSession),
  stillRunning,
  notify,
};
