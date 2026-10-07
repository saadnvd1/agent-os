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
import { MAX_TRANSCRIPT_BYTES, type TaskBundle } from "./move-bundle";
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

/** running -> moving, or a retry of a move that didn't finish. */
function claimMoving(id: string, to: string): void {
  const claimed = db
    .prepare(
      `UPDATE sessions SET task_status = 'moving', moved_to = ?
         WHERE id = ? AND task_status IN ('running', 'moving')`
    )
    .run(to, id);
  if (claimed.changes !== 1) {
    const { task_status } = getTaskSession(id);
    throw new Error(`Task is already ${task_status}`);
  }
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
  try {
    claimMoving(id, to);
    const cwd = session.working_directory;
    await stopAgent(session.tmux_name);
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
    await git(
      cwd,
      "push",
      "-q",
      "-u",
      "origin",
      `HEAD:refs/heads/${session.branch_name}`
    );

    const claudeId = await claudeIdFor(session);
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
    };
  } finally {
    exporting.delete(id);
  }
}

/** Export; if that fails here, nothing left, so the agent carries on here. */
export async function exportOrResume(
  id: string,
  to: string
): Promise<TaskBundle> {
  try {
    return await exportTask(id, to);
  } catch (err) {
    // A concurrent request's refusal leaves that move alone.
    if (getTaskSession(id).task_status === "moving" && !exporting.has(id))
      await resumeTask(id).catch((e) => {
        throw new Error(
          `${(err as Error).message}; resuming it here failed too: ${e.message}`
        );
      });
    throw err;
  }
}

export function markMoved(id: string, to: string): void {
  db.prepare(
    `UPDATE sessions SET task_status = 'moved', moved_to = ?
       WHERE id = ? AND task_status IN ('running', 'moving')`
  ).run(to, id);
}

/** Start the agent again in its worktree, resuming its conversation. */
export async function resumeTask(id: string, note?: string): Promise<void> {
  const session = getTaskSession(id);
  if (session.task_status !== "running" && session.task_status !== "moving")
    throw new Error(`Task is already ${session.task_status}`);
  if (exporting.has(id)) throw new Error("It's moving right now");
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
  db.prepare(
    `UPDATE sessions SET task_status = 'running', moved_to = NULL
       WHERE id = ? AND task_status IN ('running', 'moving')`
  ).run(id);
}
