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
  startOrQueue,
} from "../tasks/queue";
import { getStack, previewStack, startStack } from "../stacks";
import { treeOrder } from "../stacks/tree";
import type { StackItemView } from "../stacks/types";
import { doneSession } from "../done";
import { amendBrief, amendmentsOf } from "./amendments";
import { braked } from "./brakes";
import { getOrchestrator } from "./home";
import { addNote } from "./notes";
import { findWorkspaceSession } from "./read";
import { workspaceProject, workspaceStack, workspaceTask } from "./targets";

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
  const to = findWorkspaceSession(workspaceId, ref);
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
    planReason?: string;
  } = {}
): Promise<string> {
  const project = workspaceProject(workspaceId, projectRef);
  const model = parseOverride(opts.model) ?? undefined;
  const startedBy = orchestratorId(workspaceId);
  // Its brakes read this machine's usage, not the other machine's account.
  if (isRemoteHost(project.host_id))
    throw new Error(
      `${project.name} runs on another machine; the orchestrator starts tasks on this one only for now`
    );
  const view = opts.view ?? DEFAULT_START_VIEW;
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
      planReason: opts.planReason,
      startedBy,
      baseBranch: opts.base || undefined,
      after: opts.after,
      originWorkspaceId: workspaceId,
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
            planReason: opts.planReason,
            startedBy,
          }),
        (s) => s.id
      )
  );
  if ("queued" in out) {
    const { queued } = out;
    return `Queued (position ${queued.position}) task "${queued.name}" (id ${queued.id.slice(0, 8)}) in ${project.name}${queued.after ? `, after ${queued.after}` : ""}. It starts by itself; you'll get an event when it does.`;
  }
  const task = out.started;
  const skipped =
    opts.plan && task.plan_phase !== "planning"
      ? ` Plan step skipped: ${view === "terminal" ? "a terminal task has none" : "planning and implementation use the same model"}.`
      : "";
  return `Started task "${task.name}" (id ${task.id.slice(0, 8)}, ${view}) in ${project.name} on ${task.branch_name} (from ${task.base_branch}). It ends in a PR; you'll get an event when it opens.${skipped}`;
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
            })
          ).session
        : spawnSession({
            project: project.id,
            prompt,
            name: opts.name,
            model,
            startedBy,
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
// stopped, cleaned up and archived (lib/done).
export async function done(workspaceId: string, ref: string): Promise<string> {
  const s = findWorkspaceSession(workspaceId, ref);
  const out = await doneSession(s.id, { by: "orchestrator" });
  if (!out.merged) addNote(workspaceId, `Done: ${s.name}.`);
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
