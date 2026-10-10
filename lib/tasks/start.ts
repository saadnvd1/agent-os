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
import { allocatePorts } from "../ports";
import { loadProjectConfig, portBases } from "../project-config";
import { launchClaude, promptFileFor } from "../agents/launch";
import * as fs from "fs";
import { isPaused } from "../orchestrator/pause";
import { brakesEnabled } from "../orchestrator/brakes";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import { inBackground } from "../lumifyhub/task-cards";
import { enqueue, listQueue } from "../chat/queued";
import { sendQueuedNow } from "../chat/runner";
import { hasItem } from "../chat/store";
import { firstMessageId, launchPending } from "./launch-gate";

export { firstMessageId, launchPending };
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

// The task's ports (kept across a resume: the slot is on the row), then its
// worktree's setup with them.
async function prepare(
  sessionId: string,
  worktreePath: string,
  sourcePath: string
) {
  const { ports } = await allocatePorts(
    sessionId,
    portBases(loadProjectConfig(sourcePath).config)
  );
  return setupWorktree({ worktreePath, sourcePath, ports });
}

// `earlier` is a setup already done (a held start resuming): it isn't run again,
// since project setup commands (migrations, seeds) needn't be idempotent.
export async function finishTaskStart(
  sessionId: string,
  earlier?: TaskSetup
): Promise<TaskSetup> {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (!session?.worktree_path) throw new Error(`No task ${sessionId}`);
  const project = session.project_id ? getProject(session.project_id) : null;
  const done = (setup: TaskSetup) => (recordSetup(db, sessionId, setup), setup);

  const setup = earlier
    ? earlier
    : project
      ? setupOutcome(
          await prepare(
            sessionId,
            session.worktree_path,
            expandHome(project.working_directory)
          ).catch(asError)
        )
      : setupOutcome(new Error("its project no longer exists"));

  const held = launchHold(sessionId);
  // Held, not failed: resumeHeldStarts launches it once the hold clears.
  // The setup's own error is kept, for the agent's prompt when it launches.
  if (held) return done({ ...setup, status: "held" });
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
  const prompt = (session.task_prompt ?? "") + setupNote(setup);
  try {
    if (session.view === "chat") await launchChat(sessionId, prompt);
    else {
      // Only this launch creates the task's tmux session; one already there
      // (opened from an old client, say) is a bare agent without the task.
      await killTmux(session.tmux_name);
      await launchClaude({
        sessionId,
        tmuxName: session.tmux_name,
        cwd: session.worktree_path,
        model: session.model,
        prompt,
        brief: session.task_brief ?? undefined,
      });
    }
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

async function launchChat(sessionId: string, prompt: string): Promise<void> {
  const id = firstMessageId(sessionId);
  if (hasItem(sessionId, id)) return;
  enqueue(sessionId, { id, text: prompt });
  await sendQueuedNow(sessionId, id);
}

interface SetupColumns {
  setup_ms: number | null;
  setup_error: string | null;
}

const OK: TaskSetup = { status: "ok", ms: null, error: null };

// The setup a row already finished, or undefined when it never got that far:
// a fresh start's row has neither column.
function earlierSetup(row: SetupColumns): TaskSetup | undefined {
  if (row.setup_error)
    return { status: "failed", ms: row.setup_ms, error: row.setup_error };
  if (row.setup_ms != null)
    return { status: "ok", ms: row.setup_ms, error: null };
  return undefined;
}

const killTmux = (name: string) =>
  execFileAsync("tmux", ["kill-session", "-t", `=${name}`], {
    timeout: 5000,
  }).catch(() => undefined);

const tmuxAlive = (name: string) =>
  execFileAsync("tmux", ["has-session", "-t", `=${name}`], {
    timeout: 5000,
  }).then(
    () => true,
    () => false
  );

// Starts a restart cut off: setup is recorded only after the launch, so one
// still "running" never launched, unless its tmux session is up and its
// prompt was written (a session without one isn't the agent, and the launch
// replaces it), or for a chat, its first message was taken.
export async function resumeTaskStarts(
  alive: (tmuxName: string) => Promise<boolean> = tmuxAlive
): Promise<string[]> {
  const rows = db
    .prepare(
      `SELECT id, tmux_name, view, setup_ms, setup_error FROM sessions
       WHERE setup_status = 'running' AND task_status = 'running'
         AND archived_at IS NULL`
    )
    .all() as ({
    id: string;
    tmux_name: string;
    view: string;
  } & SetupColumns)[];
  const resumed = resumeHeldStarts();
  for (const row of rows) {
    const first = firstMessageId(row.id);
    // Queued means set up and launching: it's sent from the queue, and the
    // setup isn't run again under an agent that may already be at work.
    const queued =
      row.view === "chat" && listQueue(row.id).some((m) => m.id === first);
    const launched =
      row.view === "chat"
        ? queued || hasItem(row.id, first)
        : fs.existsSync(promptFileFor(row.id)) && (await alive(row.tmux_name));
    if (launched) {
      recordSetup(db, row.id, { status: "ok", ms: null, error: null });
      if (queued)
        inBackground(`first message of task ${row.id}`, () =>
          sendQueuedNow(row.id, first)
        );
      continue;
    }
    resumed.push(row.id);
    // A held start claimed before the restart already has its setup.
    inBackground(`resume start of task ${row.id}`, () =>
      finishTaskStart(row.id, earlierSetup(row))
    );
  }
  return resumed;
}

// Starts held at launch whose hold has cleared (Pause lifted, the usage
// window freed). Claiming the row first means two ticks can't both run one.
export function resumeHeldStarts(): string[] {
  const rows = db
    .prepare(
      `SELECT id, setup_ms, setup_error FROM sessions WHERE setup_status = 'held'
         AND task_status = 'running' AND archived_at IS NULL`
    )
    .all() as ({ id: string } & SetupColumns)[];
  const resumed: string[] = [];
  for (const { id, setup_ms, setup_error } of rows) {
    if (launchHold(id)) continue;
    const claimed = db
      .prepare(
        `UPDATE sessions SET setup_status = 'running' WHERE id = ? AND setup_status = 'held'`
      )
      .run(id).changes;
    if (!claimed) continue;
    resumed.push(id);
    inBackground(`resume held task ${id}`, () =>
      finishTaskStart(id, earlierSetup({ setup_ms, setup_error }) ?? OK)
    );
  }
  return resumed;
}
