/**
 * The second half of starting a task, after its row exists: set up the
 * worktree, then launch the agent. It runs in the background so nothing that
 * starts a task waits on an install, and everything it needs is on the row,
 * so a restart in the middle resumes it instead of leaving a task whose
 * agent never starts.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { setupWorktree } from "../env-setup";
import { launchClaude } from "../agents/launch";
import { isPaused } from "../orchestrator/pause";
import { brakesEnabled } from "../orchestrator/brakes";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import { inBackground } from "../lumifyhub/task-cards";
import { expandHome } from "./session";
import { recordSetup, setupNote, setupOutcome, type TaskSetup } from "./setup";

const execFileAsync = promisify(execFile);

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

// The starts the orchestrator set going (a task it started, or a card of a
// stack it started) are held at launch by Pause and the usage window, which
// can change during a long setup or a restart. A task a person started
// isn't the orchestrator's to hold.
export function launchHold(sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT workspace_id FROM orchestrator_starts
       WHERE target = ?
          OR target IN (SELECT id FROM stack_items WHERE session_id = ?)
          OR target IN (SELECT stack_id FROM stack_items WHERE session_id = ?)
       LIMIT 1`
    )
    .get(sessionId, sessionId, sessionId) as
    | { workspace_id: string }
    | undefined;
  if (!row) return null;
  if (isPaused(row.workspace_id)) return "the orchestrator is paused by Saad";
  const window = brakesEnabled() ? windowRefusal(readUsage()) : null;
  return window ? `held by the brakes: ${window}` : null;
}

export async function finishTaskStart(sessionId: string): Promise<TaskSetup> {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (!session?.worktree_path) throw new Error(`No task ${sessionId}`);
  const project = session.project_id ? getProject(session.project_id) : null;
  const done = (setup: TaskSetup) => (recordSetup(db, sessionId, setup), setup);

  const setup = project
    ? setupOutcome(
        await setupWorktree({
          worktreePath: session.worktree_path,
          sourcePath: expandHome(project.working_directory),
        }).catch(asError)
      )
    : setupOutcome(new Error("its project no longer exists"));

  const held = launchHold(sessionId);
  // Held, not failed: resumeHeldStarts launches it once the hold clears.
  if (held)
    return done({
      status: "held",
      ms: setup.ms,
      error: `Waiting to launch: ${held}`,
    });
  const now = db
    .prepare(`SELECT task_status, archived_at FROM sessions WHERE id = ?`)
    .get(sessionId) as
    | { task_status: string | null; archived_at: string | null }
    | undefined;
  if (now?.task_status !== "running" || now.archived_at)
    return done({
      status: "failed",
      ms: setup.ms,
      error: "Not launched: the task was closed during setup",
    });
  try {
    await launchClaude({
      sessionId,
      tmuxName: session.tmux_name,
      cwd: session.worktree_path,
      model: session.model,
      prompt: (session.task_prompt ?? "") + setupNote(setup),
      brief: session.task_brief ?? undefined,
    });
  } catch (error) {
    const message = `The agent did not launch: ${asError(error).message}`;
    // A stack shows why its card stopped.
    db.prepare(`UPDATE stack_items SET error = ? WHERE session_id = ?`).run(
      message.slice(0, 300),
      sessionId
    );
    return done({ status: "failed", ms: setup.ms, error: message });
  }
  return done(setup);
}

const tmuxAlive = (name: string) =>
  execFileAsync("tmux", ["has-session", "-t", `=${name}`], {
    timeout: 5000,
  }).then(
    () => true,
    () => false
  );

// Starts a restart cut off: setup is recorded only after the launch, so one
// still "running" never launched, unless its tmux session says it did.
export async function resumeTaskStarts(
  alive: (tmuxName: string) => Promise<boolean> = tmuxAlive
): Promise<string[]> {
  const rows = db
    .prepare(
      `SELECT id, tmux_name FROM sessions
       WHERE setup_status = 'running' AND task_status = 'running'
         AND archived_at IS NULL`
    )
    .all() as { id: string; tmux_name: string }[];
  const resumed = resumeHeldStarts();
  for (const row of rows) {
    if (await alive(row.tmux_name)) {
      recordSetup(db, row.id, { status: "ok", ms: null, error: null });
      continue;
    }
    resumed.push(row.id);
    inBackground(`resume start of task ${row.id}`, () =>
      finishTaskStart(row.id)
    );
  }
  return resumed;
}

// Starts held at launch whose hold has cleared (Pause lifted, the usage
// window freed). Claiming the row first means two ticks can't both run one.
export function resumeHeldStarts(): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM sessions WHERE setup_status = 'held'
         AND task_status = 'running' AND archived_at IS NULL`
    )
    .all() as { id: string }[];
  const resumed: string[] = [];
  for (const { id } of rows) {
    if (launchHold(id)) continue;
    const claimed = db
      .prepare(
        `UPDATE sessions SET setup_status = 'running' WHERE id = ? AND setup_status = 'held'`
      )
      .run(id).changes;
    if (!claimed) continue;
    resumed.push(id);
    inBackground(`resume held task ${id}`, () => finishTaskStart(id));
  }
  return resumed;
}
