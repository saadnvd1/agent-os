/**
 * What the server already knows about every session in a workspace, in one
 * shape: its status, what it's doing, its task's PR and CI, and its place in
 * a stack. The orchestrator's `sessions` tool and its event watcher both
 * read this.
 */

import { db, type Session, type StackItemStatus } from "../db";
import { statusDetector } from "../status-detector";
import { chatState } from "../chat/runner";
import { chatActivityLine } from "../chat/activity";
import { lastUserTask } from "../chat/store";
import { needsYou } from "../needs-you";
import { programSummary } from "../program-status/store";
import { sessionRowInfo } from "../session-meta";
import { taskView, type TaskPR, type TaskState } from "../tasks";
import { storedPR } from "../tasks/session";

export type FactStatus = "running" | "waiting" | "idle" | "dead";

export interface SessionFacts {
  id: string;
  name: string;
  project: string | null;
  view: "chat" | "terminal";
  status: FactStatus;
  activity: string | null;
  // Really stopped on an answer: a chat's approval or question card, or a
  // terminal at its prompt. A chat that merely finished doesn't count.
  needsInput: boolean;
  // Last sign of life, in ms.
  lastActive: number;
  // Work that should end in a PR: a task, or a session on its own branch.
  branch: string | null;
  task: { state: TaskState; pr: TaskPR | null; blocked: string | null } | null;
  stack: {
    id: string;
    name: string;
    itemId: string;
    ticket: string | null;
    position: number;
    of: number;
    status: StackItemStatus;
  } | null;
}

const sqliteMs = (t: string | null | undefined) =>
  t ? Date.parse(`${t.replace(" ", "T")}Z`) || 0 : 0;

// Live sessions in the workspace's projects, plus tasks merged in the last
// hour so their merge still reads. Never an orchestrator or an archived one.
export function workspaceSessions(
  workspaceId: string
): (Session & { project_name: string })[] {
  return db
    .prepare(
      `SELECT s.*, p.name AS project_name FROM sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.role IS NULL AND s.archived_at IS NULL
         AND (s.task_status IS NULL OR s.task_status = 'running'
           OR (s.task_status = 'merged' AND s.updated_at > datetime('now', '-1 hour')))
       ORDER BY s.created_at`
    )
    .all(workspaceId) as (Session & { project_name: string })[];
}

function stackOf(sessionId: string): SessionFacts["stack"] {
  const row = db
    .prepare(
      `SELECT i.id AS item_id, i.ticket, i.position, i.status, s.id, s.name,
         (SELECT COUNT(*) FROM stack_items WHERE stack_id = s.id) AS total
       FROM stack_items i JOIN stacks s ON s.id = i.stack_id
       WHERE i.session_id = ? ORDER BY s.created_at DESC LIMIT 1`
    )
    .get(sessionId) as
    | {
        item_id: string;
        ticket: string | null;
        position: number;
        status: StackItemStatus;
        id: string;
        name: string;
        total: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    itemId: row.item_id,
    ticket: row.ticket,
    position: row.position + 1,
    of: row.total,
    status: row.status,
  };
}

function latestChatAt(sessionId: string): number {
  const row = db
    .prepare(
      `SELECT data FROM chat_items WHERE session_id = ? ORDER BY seq DESC LIMIT 1`
    )
    .get(sessionId) as { data: string } | undefined;
  return row
    ? ((JSON.parse(row.data) as { createdAt?: number }).createdAt ?? 0)
    : 0;
}

export async function statusOf(s: Session): Promise<{
  status: FactStatus;
  activity: string | null;
  needsInput: boolean;
}> {
  if (s.view === "chat") {
    const state = chatState(s.id);
    const status: FactStatus =
      state === "running" ? "running" : needsYou(s, state) ? "waiting" : "idle";
    return {
      status,
      activity: chatActivityLine(s.id) ?? lastUserTask(s.id),
      needsInput: state === "waiting",
    };
  }
  // A task setting up, or held at launch, has no terminal yet; it isn't
  // idle, so nothing cleans it up meanwhile.
  if (
    s.task_status === "running" &&
    (s.setup_status === "running" || s.setup_status === "held")
  )
    return { status: "running", activity: "setting up", needsInput: false };
  if (!statusDetector.sessionExists(s.tmux_name))
    return { status: "dead", activity: null, needsInput: false };
  const screen = await statusDetector.getStatus(s.tmux_name);
  // A program's own report (OSC 7501) is text it chose, so here it can only
  // make things more cautious: working or blocked count, but a reported done
  // never turns a busy screen idle for planDone or `done --all-idle`. Its
  // message never reaches the orchestrator.
  const program = programSummary(s.tmux_name)?.state;
  const raw =
    screen === "running" || program === "working"
      ? "running"
      : program === "blocked"
        ? "waiting"
        : screen;
  const status: FactStatus =
    raw === "waiting" &&
    program !== "blocked" &&
    !needsYou({ ...s, view: "terminal" }, null)
      ? "idle"
      : raw;
  const info = sessionRowInfo(status, statusDetector.titleFor(s.tmux_name));
  return { status, activity: info.subtitle, needsInput: raw === "waiting" };
}

// A finished task's state is in the database: no gh call for it.
async function taskFacts(s: Session): Promise<SessionFacts["task"]> {
  if (!s.task_status) return null;
  if (s.task_status !== "running") {
    const pr = storedPR(s);
    return { state: s.task_status, pr, blocked: null };
  }
  const view = await taskView(s);
  return { state: view.state, pr: view.pr, blocked: view.blocked };
}

export async function sessionFacts(
  workspaceId: string
): Promise<SessionFacts[]> {
  await statusDetector.refreshCache();
  return Promise.all(
    workspaceSessions(workspaceId).map(async (s) => {
      const [{ status, activity, needsInput }, task] = await Promise.all([
        statusOf(s),
        taskFacts(s),
      ]);
      return {
        id: s.id,
        name: s.name,
        project: s.project_name,
        view: s.view,
        status,
        activity,
        needsInput,
        lastActive: Math.max(
          sqliteMs(s.updated_at),
          statusDetector.getTimestamp(s.tmux_name) * 1000,
          latestChatAt(s.id)
        ),
        branch: s.branch_name,
        task,
        stack: stackOf(s.id),
      };
    })
  );
}
