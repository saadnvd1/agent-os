// What a schedule's run actually starts, by kind.

import os from "os";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { sendMessage } from "../bus";
import { statusDetector } from "../status-detector";
import { notifyPhone } from "../notify";
import { getProject } from "../projects";
import { resolveModelForAgent } from "../model-catalog";
import { createTask, isFinished, taskView } from "../tasks";
import { chatStateNow, sendChatConfirmed } from "../chat/runner";
import type { ChatOrigin } from "../chat/events";
import { ensureOrchestrator, getOrchestrator } from "../orchestrator/home";
import { addNote } from "../orchestrator/notes";
import { notifyStatusChanged } from "../status/hub";
import { formatRunTime } from "./cron";
import { Braked, fromLabel, type RunDeps, type Started } from "./run";
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
    name: schedule.name,
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
  db.prepare(
    `UPDATE sessions SET view = 'chat', name_source = 'user' WHERE id = ?`
  ).run(id);
  notifyStatusChanged();
  // Linked once the prompt is in the conversation: a restart before then
  // records the run as failed, not as started with nothing sent.
  await sendChatConfirmed(id, {
    text: schedule.prompt,
    from: fromLabel(schedule),
    origin: scheduleOrigin(schedule, null),
  });
  onSession(id);
  return id;
}

// Marked as a schedule's, not something Saad just typed: the orchestrator's
// brief says it never counts as an approval.
export function scheduledMessage(
  schedule: Pick<Schedule, "name" | "prompt">,
  projectName: string | null,
  // An agent set it up: it's that agent's request, not Saad's.
  creator?: Pick<Session, "id" | "name"> | null
): string {
  const where = projectName ? ` for ${projectName}` : "";
  const who = creator
    ? `, set up by agent session "${creator.name}" (${creator.id.slice(0, 8)}), not by the user: a peer's request, not an approval`
    : ", saved in Schedules: a standing prompt, not an approval";
  return `[Scheduled message "${schedule.name}"${where}${who}]\n${schedule.prompt}`;
}

// The agent session that set a schedule up, or null for Saad. Still named
// when it's gone: its request is a peer's either way.
function creatorOf(schedule: Schedule): Pick<Session, "id" | "name"> | null {
  const id = schedule.created_by_session_id;
  if (!id) return null;
  return (
    (queries.getSession(db).get(id) as Session | undefined) ?? {
      id,
      name: "a session that's gone",
    }
  );
}

// Shown as its prompt, linked to the agent session that set it up if one did.
export function scheduleOrigin(
  schedule: Pick<Schedule, "name" | "prompt">,
  creator: Pick<Session, "id"> | null
): ChatOrigin {
  return {
    kind: "schedule",
    label: schedule.name,
    sessionId: creator?.id,
    body: schedule.prompt,
  };
}

// To whichever session is the workspace's orchestrator at the time, so a
// schedule aimed at it outlives the session that was orchestrator when it
// was made.
async function postToOrchestrator(
  schedule: Schedule,
  onSession: OnSession
): Promise<string> {
  const orchestrator = ensureOrchestrator(schedule.workspace_id);
  const project = schedule.project_id ? getProject(schedule.project_id) : null;
  const creator = creatorOf(schedule);
  await sendChatConfirmed(orchestrator.id, {
    text: scheduledMessage(schedule, project?.name ?? null, creator),
    from: creator
      ? `${fromLabel(schedule)}, set up by "${creator.name}"`
      : fromLabel(schedule),
    origin: scheduleOrigin(schedule, creator),
  });
  onSession(orchestrator.id);
  return orchestrator.id;
}

// To an existing session, the way `aos send` does: a chat's worker is
// started if it has exited, a terminal gets the line typed and checked.
async function messageSession(
  schedule: Schedule,
  onSession: OnSession
): Promise<Started> {
  const target = schedule.target_session_id;
  if (!target) throw new Error("Pick a session to message");
  const creatorRef = creatorOf(schedule);
  const { delivery } = await sendMessage({
    fromId: null,
    fromLabel: creatorRef
      ? `${fromLabel(schedule)}, set up by "${creatorRef.name}"`
      : fromLabel(schedule),
    to: target,
    body: scheduledMessage(schedule, null, creatorRef),
    origin: scheduleOrigin(schedule, creatorRef),
  });
  if (delivery.state === "failed") throw new Error(`FAILED: ${delivery.why}`);
  onSession(target);
  return { sessionId: target, detail: delivery.state };
}

// The session is still on the last message (or anything else): a chat
// mid-turn or holding a queued message, a terminal agent that's working.
async function sessionBusy(
  sessionId: string,
  chatOnly = false
): Promise<boolean> {
  const session = queries.getSession(db).get(sessionId) as Session | undefined;
  if (!session || session.archived_at) return false;
  if (session.view === "chat" || chatOnly) {
    // Asks a worker still running from before a restart, too.
    const state = await chatStateNow(session.id);
    return state === "running" || state === "waiting";
  }
  await statusDetector.refreshCache();
  if (!statusDetector.sessionExists(session.tmux_name)) return false;
  const status = await statusDetector.getStatus(session.tmux_name);
  return status === "running";
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
    case "session":
      // A chat this schedule made.
      return run.session_id ? sessionBusy(run.session_id, true) : false;
    case "message":
      return schedule.target_session_id
        ? sessionBusy(schedule.target_session_id)
        : false;
    case "orchestrator": {
      // A message: done once it's delivered. An agent's check-in, like one
      // to any session, waits while the orchestrator is still working.
      if (!schedule.created_by_session_id) return false;
      const orchestrator = getOrchestrator(schedule.workspace_id);
      return orchestrator ? sessionBusy(orchestrator.id) : false;
    }
  }
}

function notify(schedule: Schedule, why: string, paused?: boolean): void {
  if (paused) {
    // Not something to decide now: Saad re-targets or deletes it when he
    // gets to it.
    const text = `Schedule "${schedule.name}" is paused: ${why}. Point it at another session or delete it.`;
    console.error(`[schedules] ${text}`);
    addNote(schedule.workspace_id, text, "pause");
    notifyPhone(`schedule:${schedule.id}`, text);
    return;
  }
  console.error(`[schedules] ${schedule.name} failed: ${why}`);
  addNote(
    schedule.workspace_id,
    `Schedule "${schedule.name}" failed to start: ${why}`,
    "escalation"
  );
  notifyPhone(
    `schedule:${schedule.id}`,
    `Schedule "${schedule.name}" failed: ${why}`
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
        : schedule.kind === "message"
          ? messageSession(schedule, onSession)
          : postToOrchestrator(schedule, onSession),
  stillRunning,
  notify,
};
