// What a schedule's run actually starts, by kind.

import os from "os";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import { resolveModelForAgent } from "../model-catalog";
import { createTask, taskView } from "../tasks";
import { chatState, sendChatConfirmed } from "../chat/runner";
import { ensureOrchestrator } from "../orchestrator/home";
import { addNote } from "../orchestrator/notes";
import { notifyStatusChanged } from "../status/hub";
import { formatRunTime } from "./cron";
import { Braked, fromLabel, type RunDeps } from "./run";
import { braked, BrakeRefused } from "../orchestrator/brakes";
import type { Schedule, ScheduleRun } from "./store";

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

const TASK_BUSY = new Set(["working", "blocked"]);

export async function stillRunning(
  schedule: Schedule,
  run: ScheduleRun
): Promise<boolean> {
  if (!run.session_id) return false;
  const session = queries.getSession(db).get(run.session_id) as
    | Session
    | undefined;
  if (!session || session.archived_at) return false;
  switch (schedule.kind) {
    case "task":
      // Working on it, or blocked on Saad: a second copy wouldn't help.
      if (session.task_status !== "running") return false;
      return TASK_BUSY.has((await taskView(session)).state);
    case "session": {
      const state = chatState(session.id);
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
    return await braked(schedule.workspace_id, kind, start, (id) => id);
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
