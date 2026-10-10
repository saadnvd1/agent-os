/**
 * The orchestrator's acting tools: message, start, stack, drop and stop,
 * each only inside its workspace (targets.ts). Every start goes through
 * the brakes.
 */

import { sendMessage } from "../bus";
import { chatState, interruptChat } from "../chat/runner";
import { hostExec, isRemoteHost } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { spawnSession } from "../agents/spawn";
import {
  DEFAULT_START_VIEW,
  launchSession,
  type StartView,
} from "../sessions/launch";
import { createTask, dropTask } from "../tasks";
import { queueIfNeeded } from "../tasks/queue";
import { getStack, previewStack, startStack } from "../stacks";
import { treeOrder } from "../stacks/tree";
import type { StackItemView } from "../stacks/types";
import { doneSession } from "../done";
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
export async function send(
  workspaceId: string,
  ref: string,
  message: string
): Promise<string> {
  const to = findWorkspaceSession(workspaceId, ref);
  const { delivery } = await sendMessage({
    fromId: orchestratorId(workspaceId),
    to: to.id,
    body: message,
  });
  if (delivery.state === "failed")
    return `FAILED to reach ${to.name}: ${delivery.why}. It's in its inbox (aos inbox).`;
  // A terminal at a prompt refuses the message; a chat queues it behind
  // the approval or question, which only a person answers.
  if (delivery.state === "queued" && chatState(to.id) === "waiting")
    return `Queued for ${to.name}, but it's waiting on an approval or question in its chat: it sees this only once that's answered. Read it to see what it asks.`;
  return delivery.state === "queued"
    ? `Queued for ${to.name}: it's busy and will see it after this turn.`
    : `Delivered to ${to.name}.`;
}

// What the orchestrator starts opens as a chat, as a new session in the UI
// does (one default, in launch.ts); terminal is for a job that needs a TUI.
export { DEFAULT_START_VIEW, type StartView };

export async function startTask(
  workspaceId: string,
  projectRef: string,
  prompt: string,
  opts: { base?: string; name?: string; view?: StartView; after?: string } = {}
): Promise<string> {
  const project = workspaceProject(workspaceId, projectRef);
  // Its brakes read this machine's usage, not the other machine's account.
  if (isRemoteHost(project.host_id))
    throw new Error(
      `${project.name} runs on another machine; the orchestrator starts tasks on this one only for now`
    );
  const view = opts.view ?? DEFAULT_START_VIEW;
  // Held for a slot or its `after`, it starts by itself through the brakes;
  // you get an event when it does.
  const queued = queueIfNeeded({
    projectId: project.id,
    prompt,
    name: opts.name,
    view,
    baseBranch: opts.base || undefined,
    after: opts.after,
    originWorkspaceId: workspaceId,
  });
  if (queued)
    return `Queued (position ${queued.position}) task "${queued.name}" (id ${queued.id.slice(0, 8)}) in ${project.name}${queued.after ? `, after ${queued.after}` : ""}. It starts by itself; you'll get an event when it does.`;
  const task = await braked(
    workspaceId,
    "task",
    () =>
      createTask({
        projectId: project.id,
        prompt,
        name: opts.name,
        baseBranch: opts.base || undefined,
        view,
      }),
    (s) => s.id
  );
  return `Started task "${task.name}" (id ${task.id.slice(0, 8)}, ${view}) in ${project.name} on ${task.branch_name} (from ${task.base_branch}). It ends in a PR; you'll get an event when it opens.`;
}

export async function startSession(
  workspaceId: string,
  projectRef: string,
  prompt: string,
  opts: { name?: string; view?: StartView } = {}
): Promise<string> {
  const project = workspaceProject(workspaceId, projectRef);
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
            })
          ).session
        : spawnSession({ project: project.id, prompt, name: opts.name }),
    (s) => s.id
  );
  return `Started session "${session.name}" (id ${session.id.slice(0, 8)}, ${session.view}) in ${project.name}.`;
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
  const task = workspaceTask(workspaceId, ref);
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
  const s = findWorkspaceSession(workspaceId, ref);
  if (s.view === "chat") {
    await interruptChat(s.id);
    return `Stopped ${s.name}'s turn.`;
  }
  await hostExec(
    s.host_id,
    `tmux kill-session -t ${shellQuote(`=${s.tmux_name}`)} 2>/dev/null || true`
  );
  return `Stopped ${s.name}: its agent is ended, its worktree and branch are kept.`;
}
