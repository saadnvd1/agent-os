/**
 * The leaving half of a move, which every machine runs: claim the task as
 * moving, stop the agent, commit what's uncommitted, push the branch and hand
 * over the conversation. The row stays; it ends moved (the other machine has
 * it) or running again (resumeTask), and while it's moving nothing can sign
 * it off and a second move of it is refused.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { endTmuxSession } from "../tmux/end";
import { launchClaude } from "../agents/launch";
import { buildTaskBrief, briefFacts } from "./brief";
import { git as runGit } from "../git-exec";
import { getTaskSession, isoUTC } from "./session";
import { projectRef } from "./project-ref";
import { isOrchestrated, moveRefusal } from "./move-guard";
import {
  MAX_PLAN_BYTES,
  MAX_TRANSCRIPT_BYTES,
  type OrchestratedBundle,
  type TaskBundle,
} from "./move-bundle";
import { stepProgress } from "./move-progress";
import { PLAN_FILE } from "../models/plan-step";
import { releaseSessionLeftovers } from "../sessions/leftovers";
import { releaseChat } from "../chat/runner";
import { collectWhileMoving } from "../chat/hold";
import { packChat, stopChatForMove } from "./move-chat";
import { orchestratorOf as starterOrchestrator } from "./starter";
import {
  isClaudeSessionId,
  latestSessionId,
  readTranscript,
} from "./transcript";
import { setTask } from "../db/session-parts";

export * from "./move-bundle";

const git = (cwd: string, ...args: string[]) =>
  runGit(cwd, args, { timeout: 120000 });

// Moves in flight in this process; the row's 'moving' outlives a restart.
const g = globalThis as unknown as { __agentosExporting?: Set<string> };
const exporting = (g.__agentosExporting ??= new Set());

async function stopAgent(tmuxName: string): Promise<void> {
  await endTmuxSession(null, tmuxName);
}

export async function claudeIdFor(session: Session): Promise<string | null> {
  const id = session.claude_session_id;
  if (id && isClaudeSessionId(id)) return id;
  return latestSessionId(session.working_directory);
}

/**
 * The task's own branch, as its agent left it. An agent that reworded or
 * squashed commits it had pushed (the wip one a move makes, say) needs a
 * force, but only over commits this branch has had: --force-if-includes
 * refuses a remote tip that was fetched and never taken in, so someone
 * else's push is never overwritten. What was pushed is kept under
 * refs/agentos/pushed/, for the worktree this leaves behind.
 */
export const pushedRef = (branch: string) => `refs/agentos/pushed/${branch}`;

async function pushOwnBranch(cwd: string, branch: string): Promise<void> {
  const ref = `refs/heads/${branch}`;
  const tracked = await git(
    cwd,
    "rev-parse",
    "--verify",
    "-q",
    `refs/remotes/origin/${branch}`
  ).catch(() => "");
  const force = tracked.trim()
    ? [`--force-with-lease=${ref}`, "--force-if-includes"]
    : [];
  await git(cwd, "push", "-q", "-u", ...force, "origin", `HEAD:${ref}`);
  await git(cwd, "update-ref", pushedRef(branch), "HEAD");
}

/**
 * running -> moving (fresh), or a retry of a move to the same machine that
 * didn't finish. Never a retry to another machine: the first may have
 * arrived, and then it would run on both.
 */
function claimMoving(id: string, to: string): { fresh: boolean } {
  const fresh = setTask(
    db,
    id,
    { task_status: "moving", moved_to: to },
    { task_status: "running" }
  );
  if (fresh) return { fresh: true };
  const { task_status, moved_to } = getTaskSession(id);
  if (task_status === "moving" && moved_to === to) return { fresh: false };
  throw new Error(
    task_status === "moving"
      ? `It's partway through moving to ${moved_to}; finish that first`
      : `Task is already ${task_status}`
  );
}

// Set by exportTask: did this call stop a running agent, or retry a move?
const freshClaims = new Set<string>();

const readPlanFile = (cwd: string): string | null => {
  try {
    const text = fs.readFileSync(path.join(cwd, PLAN_FILE), "utf8");
    return text.length > MAX_PLAN_BYTES ? null : text;
  } catch {
    return null;
  }
};

// The orchestrator that holds the task: its own, or the one on the machine
// that moved it here.
function orchestratorOf(
  session: Session
): { id: string; name: string } | undefined {
  if (session.held_for && session.held_for_name)
    return { id: session.held_for, name: session.held_for_name };
  const by = starterOrchestrator(session.started_by);
  if (!by) return undefined;
  const o = db.prepare(`SELECT name FROM sessions WHERE id = ?`).get(by) as
    { name: string } | undefined;
  return o ? { id: by, name: o.name } : undefined;
}

// What an orchestrator's task carries besides its work (the orchestrator's
// own state is re-keyed here; see move-carry).
function orchestratedBundle(session: Session): OrchestratedBundle {
  return {
    heldFrom: session.held_from || os.hostname(),
    since: isoUTC(session.task_since ?? session.created_at),
    modelProvider: session.model_provider ?? null,
    modelOverrides: session.model_overrides ?? null,
    // moveRefusal keeps an unapproved plan-only task here.
    planPhase: (session.plan_phase ?? null) as OrchestratedBundle["planPhase"],
    planFile: readPlanFile(session.working_directory),
    orchestrator: orchestratorOf(session),
  };
}

/**
 * Stops the agent and pushes everything. On failure the task stays moving;
 * the caller resumes it (exportOrResume) when it knows nothing arrived.
 */
export async function exportTask(id: string, to: string): Promise<TaskBundle> {
  const session = getTaskSession(id);
  const project = session.project_id ? getProject(session.project_id) : null;
  if (!project || !session.branch_name)
    throw new Error("Only a task with its own worktree and branch can move");
  if (exporting.has(id)) throw new Error("It's already moving");
  exporting.add(id);
  freshClaims.delete(id);
  const packed = collectWhileMoving(id);
  try {
    const refusal = moveRefusal(session);
    if (refusal) throw new Error(refusal);
    if (claimMoving(id, to).fresh) freshClaims.add(id);
    const cwd = session.working_directory;
    // A chat is held from here on (lib/chat/hold): its turn ends, and what's
    // sent meanwhile waits in its queue and goes with it.
    const chat = session.view === "chat";
    if (chat) {
      stepProgress(id, "turn");
      await stopChatForMove(id, () => {});
    }
    stepProgress(id, "save");
    if (!chat) await stopAgent(session.tmux_name);
    if ((await git(cwd, "status", "--porcelain")).trim()) {
      await git(cwd, "add", "-A");
      await git(
        cwd,
        "commit",
        "-q",
        "--no-verify",
        "-m",
        `wip: moving to ${to}`
      );
    }
    stepProgress(id, "push");
    await pushOwnBranch(cwd, session.branch_name);
    stepProgress(id, "conversation");

    // Its worker kept the conversation's id up to date until it closed.
    const now = getTaskSession(id);
    const claudeId = await claudeIdFor(now);
    const transcript = claudeId ? await readTranscript(cwd, claudeId) : null;
    if (transcript && transcript.length > MAX_TRANSCRIPT_BYTES)
      throw new Error("The conversation is too large to move");
    // From here a message is refused, not queued: the queue is packed.
    const chatBundle = chat ? packChat(now) : undefined;
    packed();
    return {
      moveId: id,
      name: session.name,
      prompt: session.task_prompt ?? "",
      model: session.model,
      branch: session.branch_name,
      baseBranch: session.base_branch,
      project: await projectRef(project),
      from: os.hostname(),
      claude:
        claudeId && transcript
          ? { sessionId: claudeId, cwd, home: os.homedir(), transcript }
          : null,
      chat: chatBundle,
      orchestrated: isOrchestrated(now) ? orchestratedBundle(now) : undefined,
      planWait:
        now.plan_waits_for_caller && now.plan_phase === "awaiting"
          ? { file: readPlanFile(cwd) }
          : undefined,
    };
  } finally {
    packed();
    exporting.delete(id);
  }
}

/**
 * Export; if this call stopped the agent and then failed, nothing left, so
 * the agent carries on here. A failed retry leaves it moving: an earlier try
 * may have arrived.
 */
export async function exportOrResume(
  id: string,
  to: string
): Promise<TaskBundle> {
  try {
    const bundle = await exportTask(id, to);
    freshClaims.delete(id);
    return bundle;
  } catch (err) {
    // Refused because another request is moving it: that one decides.
    if (exporting.has(id)) throw err;
    if (freshClaims.delete(id))
      await resumeTask(id).catch((e) => {
        throw new Error(
          `${(err as Error).message}; resuming it here failed too: ${e.message}`
        );
      });
    throw err;
  }
}

export function markMoved(id: string, to: string): void {
  const moved = setTask(
    db,
    id,
    { task_status: "moved", moved_to: to },
    { task_status: ["running", "moving"] }
  );
  // It goes on there with a copy of its own.
  if (moved) void releaseSessionLeftovers({ id });
}

/**
 * moving -> running: start the agent again in its worktree on its
 * conversation. Already running means a repeat of a resume that worked, so
 * it leaves that agent alone. A chat stopped between turns, so it isn't
 * relaunched: what was queued while it was held goes now, and anything sent
 * later starts its worker on the same conversation.
 */
export async function resumeTask(id: string, note?: string): Promise<void> {
  if (exporting.has(id)) throw new Error("It's moving right now");
  const claimed = setTask(
    db,
    id,
    { task_status: "running" },
    { task_status: "moving" }
  );
  const session = getTaskSession(id);
  if (!claimed) {
    if (session.task_status === "running") return;
    throw new Error(`Task is already ${session.task_status}`);
  }
  try {
    await relaunch(session, note);
  } catch (err) {
    setTask(db, id, { task_status: "moving" }, { task_status: "running" });
    throw err;
  }
  setTask(db, id, { moved_to: null });
}

async function relaunch(session: Session, note?: string): Promise<void> {
  const id = session.id;
  if (session.view === "chat") return releaseChat(id);
  const claudeId = await claudeIdFor(session);
  await stopAgent(session.tmux_name);
  await launchClaude({
    sessionId: id,
    tmuxName: session.tmux_name,
    cwd: session.working_directory,
    model: session.model,
    prompt: claudeId
      ? (note ??
        "The move to another machine didn't go through. Carry on here.")
      : (session.task_prompt ?? ""),
    resume: claudeId ?? undefined,
    brief: session.branch_name
      ? buildTaskBrief({
          branch: session.branch_name,
          baseBranch: session.base_branch ?? "main",
          ...briefFacts(session.working_directory),
        })
      : undefined,
  });
}
