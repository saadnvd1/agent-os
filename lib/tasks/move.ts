/**
 * The leaving half of a move, which every machine runs: claim the task as
 * moving, stop the agent, commit what's uncommitted, push the branch and hand
 * over the conversation. The row stays; it ends moved (the other machine has
 * it) or running again (resumeTask), and while it's moving nothing can sign
 * it off and a second move of it is refused.
 */

import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { launchClaude } from "../agents/launch";
import { buildTaskBrief } from "./brief";
import { run } from "./gh";
import { getTaskSession } from "./session";
import { projectRef } from "./project-ref";
import { moveRefusal } from "./move-guard";
import { MAX_TRANSCRIPT_BYTES, type TaskBundle } from "./move-bundle";
import { stepProgress } from "./move-progress";
import { dropSessionDatabase } from "../project-config/database";
import { releaseChat } from "../chat/runner";
import { packChat, stopChatForMove } from "./move-chat";
import {
  isClaudeSessionId,
  latestSessionId,
  readTranscript,
} from "./transcript";

export * from "./move-bundle";

const execFileAsync = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", args, cwd, 120000);

// Moves in flight in this process; the row's 'moving' outlives a restart.
const g = globalThis as unknown as { __agentosExporting?: Set<string> };
const exporting = (g.__agentosExporting ??= new Set());

async function stopAgent(tmuxName: string): Promise<void> {
  await execFileAsync("tmux", ["kill-session", "-t", `=${tmuxName}`]).catch(
    () => undefined
  );
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
  const fresh = db
    .prepare(
      `UPDATE sessions SET task_status = 'moving', moved_to = ?
         WHERE id = ? AND task_status = 'running'`
    )
    .run(to, id);
  if (fresh.changes === 1) return { fresh: true };
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
      chat: chat ? packChat(now) : undefined,
    };
  } finally {
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
  const moved = db
    .prepare(
      `UPDATE sessions SET task_status = 'moved', moved_to = ?
       WHERE id = ? AND task_status IN ('running', 'moving')`
    )
    .run(to, id).changes;
  // It goes on there with a copy of its own.
  if (moved) void dropSessionDatabase(id);
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
  const claimed = db
    .prepare(
      `UPDATE sessions SET task_status = 'running' WHERE id = ? AND task_status = 'moving'`
    )
    .run(id);
  const session = getTaskSession(id);
  if (claimed.changes !== 1) {
    if (session.task_status === "running") return;
    throw new Error(`Task is already ${session.task_status}`);
  }
  try {
    await relaunch(session, note);
  } catch (err) {
    db.prepare(
      `UPDATE sessions SET task_status = 'moving' WHERE id = ? AND task_status = 'running'`
    ).run(id);
    throw err;
  }
  db.prepare(`UPDATE sessions SET moved_to = NULL WHERE id = ?`).run(id);
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
        })
      : undefined,
  });
}
