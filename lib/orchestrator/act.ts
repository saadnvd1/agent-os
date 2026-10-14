/**
 * The orchestrator's acting tools: message, start, stack, drop and stop,
 * each only inside its workspace (targets.ts). Every start goes through
 * the brakes.
 */

import {
  parseOverride,
  sessionModelRef,
  type ModelOverride,
} from "../models/resolve";
import { sendMessage } from "../bus";
import { chatState } from "../chat/runner";
import { stopSession } from "../sessions/stop";
import { isRemoteHost } from "../hosts";
import { spawnSession } from "../agents/spawn";
import {
  DEFAULT_START_VIEW,
  launchSession,
  type StartView,
} from "../sessions/launch";
import { assertMovable, createTask, dropTask, moveTask } from "../tasks";
import { getHost, hostIdNamed } from "../hosts";
import { queueEvent } from "./events";
import {
  findQueued,
  queuedLabel,
  removeQueued,
  slotState,
  startOrQueue,
  startQueuedForOrchestrator,
} from "../tasks/queue";
import { getStack, previewStack, startStack } from "../stacks";
import { treeOrder } from "../stacks/tree";
import type { StackItemView } from "../stacks/types";
import { doneSession } from "../done";
import { archiveChecked } from "../done/archive";
import { amendBrief, amendmentsOf } from "./amendments";
import { db, type Session } from "../db";
import { resurrectSession } from "../resurrect";
import { resolveEnded } from "../resurrect/find";
import { findPiece, pieceLabel, workspacePieces } from "../plans/claim";
import { approvePlanNow } from "../models/plan-step";
import { braked } from "./brakes";
import { getOrchestrator } from "./home";
import { addNote } from "./notes";
import { findWorkspaceSession } from "./read";
import {
  assertTakesMessages,
  findQueuedTarget,
  heldQueuedNote,
  type QueuedTarget,
} from "../tasks/queue-held";
import { workspaceProject, workspaceStack, workspaceTask } from "./targets";
import { setPriority, stampPriority } from "../tasks/queue";
import {
  PauseRefused,
  activePause,
  requestPause,
  resumeNow,
} from "../tasks/pause";
import { pauseUntil, type PausePreset } from "../sidebar/snooze";
import type { Priority } from "../tasks/schedule-types";

function orchestratorId(workspaceId: string): string {
  const o = getOrchestrator(workspaceId);
  if (!o) throw new Error("This workspace has no orchestrator yet");
  return o.id;
}

// Sent as the orchestrator, so the bus's pair limit and the event
// watcher's quiet window both know who spoke.
// With `scopeChange`, the message is also recorded on the task as an
// amendment to its brief, before it's sent, so its review judges the PR
// against the brief as amended.
export async function send(
  workspaceId: string,
  ref: string,
  message: string,
  opts: { scopeChange?: boolean } = {}
): Promise<string> {
  let to;
  try {
    to = findWorkspaceSession(workspaceId, ref);
  } catch (error) {
    // A task still in the queue has no session: it holds the message.
    const queued = findQueuedTarget(ref, { workspaceId });
    if (!queued) throw error;
    return sendToQueued(workspaceId, queued, message, opts);
  }
  let amended = "";
  if (opts.scopeChange) {
    if (to.task_status !== "running")
      throw new Error(
        `${to.name} isn't a running task; a scope change is recorded only on one`
      );
    amendBrief(workspaceId, to.id, message);
    // In the decision log, so Saad sees every change of scope it records.
    addNote(workspaceId, `Scope change for ${to.name}: ${message}`);
    amended = ` Recorded as scope change ${amendmentsOf(to.id).length} on its brief: reviews from now on judge against it (call review with fresh to judge the current head again).`;
  }
  const { delivery } = await sendMessage({
    fromId: orchestratorId(workspaceId),
    to: to.id,
    body: message,
  });
  if (delivery.state === "failed")
    return `FAILED to reach ${to.name}: ${delivery.why}. It's in its inbox (aos inbox).${amended}`;
  // A terminal at a prompt refuses the message; a chat queues it behind
  // the approval or question, which only a person answers.
  if (delivery.state === "queued" && chatState(to.id) === "waiting")
    return `Queued for ${to.name}, but it's waiting on an approval or question in its chat: it sees this only once that's answered. Read it to see what it asks.${amended}`;
  return delivery.state === "queued"
    ? `Queued for ${to.name}: it's busy and will see it after this turn.${amended}`
    : `Delivered to ${to.name}.${amended}`;
}

// A queued task's id is the session id it starts as, so the amendment
// recorded under it is already the running task's.
async function sendToQueued(
  workspaceId: string,
  queued: QueuedTarget,
  message: string,
  opts: { scopeChange?: boolean }
): Promise<string> {
  assertTakesMessages(queued);
  let amended = "";
  if (opts.scopeChange) {
    amendBrief(workspaceId, queued.id, message);
    addNote(workspaceId, `Scope change for ${queued.name}: ${message}`);
    amended = ` Recorded as scope change ${amendmentsOf(queued.id).length} on its brief: reviews judge against it once it has a PR.`;
  }
  const sent = await sendMessage({
    fromId: orchestratorId(workspaceId),
    to: queued.id,
    body: message,
  });
  // It may have started in between: then it was delivered as to any task.
  return sent.heldForQueued
    ? `${heldQueuedNote(queued.name)}${amended}`
    : `Delivered to ${queued.name}.${amended}`;
}

// What the orchestrator starts opens as a chat, as a new session in the UI
// does (one default, in launch.ts); terminal is for a job that needs a TUI.
export { DEFAULT_START_VIEW, type StartView };

export async function startTask(
  workspaceId: string,
  projectRef: string,
  prompt: string,
  opts: {
    base?: string;
    name?: string;
    view?: StartView;
    after?: string;
    model?: ModelOverride;
    plan?: boolean;
    planOnly?: boolean;
    planReason?: string;
    priority?: Priority;
    machine?: "mac" | "any";
    now?: boolean;
    nowReason?: string;
    piece?: string;
  } = {}
): Promise<string> {
  if (opts.planOnly && opts.plan === false)
    throw new Error("plan_only implies plan; pass plan true");
  if (opts.now && !opts.nowReason)
    throw new Error("now needs now_reason: say why it can't wait for a slot");
  const project = workspaceProject(workspaceId, projectRef);
  const model = parseOverride(opts.model) ?? undefined;
  const startedBy = orchestratorId(workspaceId);
  const pieceId = opts.piece
    ? findPiece(workspacePieces(workspaceId, project.id), opts.piece).id
    : undefined;
  // Its brakes read this machine's usage, not the other machine's account.
  if (isRemoteHost(project.host_id))
    throw new Error(
      `${project.name} runs on another machine; the orchestrator starts tasks on this one only for now`
    );
  const view = opts.view ?? DEFAULT_START_VIEW;
  const slots = slotState(project.id);
  // Held for a slot or its `after`, it starts by itself through the brakes;
  // you get an event when it does.
  const out = await startOrQueue(
    {
      projectId: project.id,
      prompt,
      name: opts.name,
      view,
      model,
      plan: opts.plan,
      planOnly: opts.planOnly,
      planReason: opts.planReason,
      startedBy,
      parentSessionId: startedBy,
      startedVia: "orchestrator",
      pieceId,
      baseBranch: opts.base || undefined,
      after: opts.after,
      originWorkspaceId: workspaceId,
      priority: opts.priority,
      machine: opts.machine,
      now: opts.now,
    },
    () =>
      braked(
        workspaceId,
        "task",
        () =>
          createTask({
            projectId: project.id,
            prompt,
            name: opts.name,
            baseBranch: opts.base || undefined,
            view,
            model,
            plan: opts.plan,
            planOnly: opts.planOnly,
            planReason: opts.planReason,
            startedBy,
            parentSessionId: startedBy,
            startedVia: "orchestrator",
            pieceId,
          }),
        (s) => s.id
      )
  );
  if ("queued" in out) {
    const { queued } = out;
    const builds = pieceId ? ` It builds ${pieceLabel(pieceId)}.` : "";
    return `Queued (position ${queued.position}) task "${queued.name}" (id ${queued.id.slice(0, 8)}) in ${project.name}${queued.after ? `, after ${queued.after}` : ""}.${builds} It starts by itself; you'll get an event when it does.`;
  }
  const task = out.started;
  if (opts.priority) stampPriority(task.id, opts.priority);
  const past = opts.now && slots.full && !opts.planOnly;
  if (past)
    addNote(
      workspaceId,
      `Started "${task.name}" past the running-task limit (${slots.running} of ${slots.limit} running): ${opts.nowReason}`
    );
  const planOnlyNote = opts.planOnly
    ? " Plan only: it stops after the plan and waits; approve_plan continues it, drop rejects it."
    : "";
  const skipped =
    opts.plan && !opts.planOnly && task.plan_phase !== "planning"
      ? ` Plan step skipped: ${view === "terminal" ? "a terminal task has none" : "planning and implementation use the same model"}.`
      : "";
  return `Started task "${task.name}" (id ${task.id.slice(0, 8)}, ${view}) in ${project.name} on ${task.branch_name} (from ${task.base_branch}). It ends in a PR; you'll get an event when it opens.${pieceId ? ` It builds ${pieceLabel(pieceId)}.` : ""}${skipped}${planOnlyNote}${past ? " Started past the running-task limit." : ""}`;
}

// Starts a queued task now, past the running-task limit and its `after`.
// Pause, the brakes and a machine need still hold it.
export async function startNow(
  workspaceId: string,
  ref: string,
  reason: string
): Promise<string> {
  const queued = findQueued(workspaceId, ref, { byName: true });
  if (!queued) {
    const running = workspaceTask(workspaceId, ref);
    throw new Error(`${running.name} is already started, not queued`);
  }
  const name = queuedLabel(queued);
  const out = await startQueuedForOrchestrator(workspaceId, queued.id);
  if (out.outcome === "held")
    return `Not started: ${out.text}. ${name} stays in the queue.`;
  if (out.outcome === "failed") return `Could not start ${name}: ${out.text}.`;
  const skipped = [
    out.wasFull
      ? `past the running-task limit (${out.running} of ${out.limit} running)`
      : "",
    out.skippedAfter ? "without waiting for its after" : "",
  ]
    .filter(Boolean)
    .join(", ");
  addNote(
    workspaceId,
    `Started queued ${name} now${skipped ? `, ${skipped}` : ""}: ${reason}`
  );
  return `Started ${name} (id ${queued.id.slice(0, 8)}) now${skipped ? `, ${skipped}` : ""}. You'll get an event when its PR opens.`;
}

// The orchestrator approves a plan-only task's plan; a message amends it.
export async function approveTaskPlan(
  task: Session,
  message?: string
): Promise<string> {
  const out = await approvePlanNow(task.id, message, "orchestrator");
  const amended = message
    ? ` Recorded as scope change ${out.amendments} on its brief: its review judges against it.`
    : " Recorded the approval on its brief.";
  return `Approved the plan of ${task.name}: implementing on ${out.ref}.${amended}`;
}

export async function startSession(
  workspaceId: string,
  projectRef: string,
  prompt: string,
  opts: { name?: string; view?: StartView; model?: string } = {}
): Promise<string> {
  const project = workspaceProject(workspaceId, projectRef);
  const startedBy = orchestratorId(workspaceId);
  const model = parseOverride(opts.model);
  if (model && typeof model !== "string")
    throw new Error(`model: a session takes one "provider/model"`);
  const view = opts.view ?? DEFAULT_START_VIEW;
  if (view === "chat" && isRemoteHost(project.host_id))
    throw new Error("Spawning on other machines isn't supported yet");
  const session = await braked(
    workspaceId,
    "session",
    async () =>
      view === "chat"
        ? (
            await launchSession({
              projectId: project.id,
              agentType: "claude",
              prompt,
              name: opts.name,
              view,
              access: "full",
              model,
              startedBy,
              parentSessionId: startedBy,
              startedVia: "orchestrator",
            })
          ).session
        : spawnSession({
            project: project.id,
            prompt,
            name: opts.name,
            model,
            startedBy,
            parentSessionId: startedBy,
          }),
    (s) => s.id
  );
  return `Started session "${session.name}" (id ${session.id.slice(0, 8)}, ${session.view}) in ${project.name} on ${sessionModelRef(session)}.`;
}

function itemLine(i: StackItemView): string {
  const name = i.ticket ? `${i.ticket} ${i.title}` : i.title;
  const pr = i.prNumber ? ` PR #${i.prNumber}` : "";
  const why = i.error || i.waitsOn || i.note;
  return `${"  ".repeat(i.depth + 1)}${i.status} ${name}${pr}${why ? ` (${why})` : ""}`;
}

const stackItems = (items: StackItemView[]) =>
  treeOrder(items).map(itemLine).join("\n");

export async function stack(
  workspaceId: string,
  ref: string,
  planOnly = false
): Promise<string> {
  const project = workspaceProject(workspaceId, ref, { boards: true });
  if (planOnly) {
    const plan = await previewStack(project.id);
    return `Plan for ${plan.boardName ?? plan.projectName} (nothing started):\n${stackItems(plan.items)}`;
  }
  const view = await braked(
    workspaceId,
    "stack",
    () => startStack({ projectId: project.id }),
    (v) => v.id
  );
  return `Started stack "${view.name}" (id ${view.id}, ${view.maxParallel} at a time):\n${stackItems(view.items)}`;
}

export function stackStatus(workspaceId: string, ref: string): string {
  const view = getStack(workspaceStack(workspaceId, ref).id);
  const extra = [view.progress, view.error].filter(Boolean).join("; ");
  return `Stack "${view.name}" (id ${view.id}, ${view.projectName}): ${view.status}${extra ? `, ${extra}` : ""}\n${stackItems(view.items)}`;
}

export async function drop(
  workspaceId: string,
  ref: string,
  reason: string
): Promise<string> {
  if (!reason.trim()) throw new Error("Say why it's dropped");
  // A task still in the queue has no session yet: its id removes it.
  const removeQueuedTask = (
    queued: NonNullable<ReturnType<typeof findQueued>>
  ) => {
    removeQueued(queued.id);
    addNote(
      workspaceId,
      `Removed queued task ${queuedLabel(queued)} before it started: ${reason.trim()}`
    );
    return `Removed queued task "${queuedLabel(queued)}" (id ${queued.id.slice(0, 8)}) from the queue; it never started.`;
  };
  const byId = findQueued(workspaceId, ref);
  if (byId) return removeQueuedTask(byId);
  let task;
  try {
    task = workspaceTask(workspaceId, ref);
  } catch (error) {
    const byName = findQueued(workspaceId, ref, { byName: true });
    if (byName) return removeQueuedTask(byName);
    throw error;
  }
  await dropTask(task.id);
  addNote(workspaceId, `Dropped task ${task.name}: ${reason.trim()}`);
  return `Dropped ${task.name}: its PR is closed and its worktree removed.`;
}

// Finished work: merged through the gates if its PR is open, then
// stopped and cleaned up, then left on the Done shelf (lib/done).
export async function done(workspaceId: string, ref: string): Promise<string> {
  const s = findWorkspaceSession(workspaceId, ref);
  const out = await doneSession(s.id, { by: "orchestrator" });
  if (!out.merged) addNote(workspaceId, `Done: ${s.name}.`);
  return out.text;
}

// Puts a session away, out of the sidebar; nothing else changes.
export async function archive(
  workspaceId: string,
  ref: string
): Promise<string> {
  const s = findWorkspaceSession(workspaceId, ref);
  await archiveChecked(s.id);
  addNote(workspaceId, `Archived: ${s.name}.`);
  return `Archived ${s.name}: out of the sidebar, in Archived.`;
}

// Brings a dropped, done or archived session back, same id and conversation.
// A task takes a running slot again, so it goes through the brakes like a
// start; an unarchive or reopen starts nothing.
export async function resurrect(
  workspaceId: string,
  ref: string,
  reason: string
): Promise<string> {
  if (!reason.trim()) throw new Error("Say why it's restored");
  const id = resolveEnded(ref, { workspaceId });
  const row = db
    .prepare(`SELECT task_status, archived_at FROM sessions WHERE id = ?`)
    .get(id) as { task_status: string | null; archived_at: string | null };
  const task =
    row.task_status === "dropped" ||
    (row.task_status === "done" && !row.archived_at);
  const go = () => resurrectSession(id);
  const out = task
    ? await braked(workspaceId, "task", go, (o) => o.id)
    : await go();
  addNote(workspaceId, `Restored ${out.name}: ${reason.trim()}`);
  return out.text;
}

// Stops the agent and keeps everything else: a chat's turn is interrupted,
// a terminal's tmux session ends. Its worktree and branch stay.
export async function stop(workspaceId: string, ref: string): Promise<string> {
  return stopSession(findWorkspaceSession(workspaceId, ref));
}

// Carries a task to a linked machine, or back ("here"): heavy test or build
// work can run on the box. The move takes minutes, so it runs in the
// background; the orchestrator is told when the task lands or doesn't.
// Everything about the task (gates, events, read/send/stop/drop) is the same
// wherever it runs; the machine it lands on holds it for this one.
export async function moveTaskTo(
  workspaceId: string,
  ref: string,
  machine: string
): Promise<string> {
  const task = workspaceTask(workspaceId, ref);
  const hostId = hostIdNamed(machine);
  assertMovable(task.id, hostId);
  const where = hostId === "local" ? "this machine" : machineName(hostId);
  void moveTask(task.id, hostId).then(
    (moved) => {
      addNote(workspaceId, `Moved task ${task.name} to ${where}.`);
      queueEvent(
        workspaceId,
        `move:${moved.id}:${Date.now()}`,
        moved.id,
        `Task ${task.name} now runs on ${where}.`
      );
    },
    (error) =>
      queueEvent(
        workspaceId,
        `move-failed:${task.id}:${Date.now()}`,
        task.id,
        `Moving task ${task.name} to ${where} failed: ${error instanceof Error ? error.message : String(error)}. It carries on where it was unless it says it's paused as "moving".`
      )
  );
  return `Moving ${task.name} to ${where}. It takes a few minutes; an event tells you when it runs there.`;
}

const machineName = (hostId: string) =>
  getHost(hostId)?.name ?? "the other machine";

// A queued task re-ranks at once; a running one only carries the word.
export function setTaskPriority(
  workspaceId: string,
  ref: string,
  priority: Priority
): string {
  const queued = findQueued(workspaceId, ref, { byName: true });
  if (queued) {
    setPriority(queued.id, priority);
    return `${queued.name} is ${priority} in the queue now.`;
  }
  const task = workspaceTask(workspaceId, ref);
  setPriority(task.id, priority);
  const running = task.task_status === "running";
  return running
    ? `${task.name} is ${priority}. It's running, so this only matters if it is paused and waits to resume.`
    : `${task.name} is ${priority}. It's ${task.task_status ?? "not queued"}, so this changes nothing now.`;
}

const PAUSE_FOR: Record<string, PausePreset> = {
  "1h": "1h",
  "2h": "2h",
  tomorrow: "tomorrow",
  until_resumed: "until-resumed",
};

export function pauseTask(
  workspaceId: string,
  ref: string,
  howLong: string,
  now: boolean,
  reason: string
): string {
  const task = workspaceTask(workspaceId, ref);
  const preset = PAUSE_FOR[howLong];
  if (!preset) throw new Error("for is 1h, 2h, tomorrow or until_resumed");
  try {
    requestPause(task.id, {
      until: pauseUntil(preset),
      mode: now ? "now" : "turn",
      by: "orchestrator",
      byId: orchestratorId(workspaceId),
      reason,
    });
  } catch (error) {
    if (error instanceof PauseRefused)
      throw new Error(`Can't pause ${task.name}: ${error.message}`);
    throw error;
  }
  return `Pausing ${task.name} ${now ? "now" : "at the end of its step"}. Its slot frees once it has stopped; an event says when.`;
}

export async function resumeTask(
  workspaceId: string,
  ref: string
): Promise<string> {
  const task = workspaceTask(workspaceId, ref);
  if (!activePause(task.id)) throw new Error(`${task.name} isn't paused`);
  const slots = task.project_id ? slotState(task.project_id) : null;
  let out;
  try {
    out = await resumeNow(task.id, "orchestrator");
  } catch (error) {
    if (error instanceof PauseRefused) throw new Error(error.message);
    throw error;
  }
  if (out.outcome === "held")
    return `${task.name} is ${out.note}. It resumes by itself when that clears.`;
  if (out.outcome === "cancelled")
    return `${task.name} keeps running: its pause was cancelled.`;
  const past = slots?.full
    ? ` past the running-task limit (${slots.running} of ${slots.limit} running)`
    : "";
  addNote(workspaceId, `Resumed ${task.name} now${past}.`);
  return `Resumed ${task.name} now${past}. It carries on with what was held for it.`;
}
