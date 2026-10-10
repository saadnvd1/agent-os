/**
 * Async tasks: a prompt becomes an agent working alone in its own worktree,
 * which ends by opening a PR. A human signs off (squash-merge + cleanup) or
 * drops it.
 */

import { processTable, runsSomething } from "../process-table";
import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import {
  createWorktree,
  discardLeftoverStart,
  worktreePathFor,
} from "../worktrees";
import {
  generateBranchName,
  getDefaultBranch,
  isBranchName,
  slugify,
} from "../git";
import { resolveModelForAgent } from "../model-catalog";
import { getProvider } from "../providers";
import { statusDetector } from "../status-detector";
import { buildTaskBrief, type StackedOn } from "./brief";
import {
  attachTaskCard,
  inBackground,
  syncTaskCardInBackground,
  taskCardUrl,
} from "../lumifyhub/task-cards";
import {
  blockedReason,
  deriveTaskState,
  type TaskPR,
  type TaskState,
} from "./state";
import { expandHome, prFor, storedPR, taskSessions } from "./session";
import { InProgressError } from "./move-bundle";
import { nameFor } from "../session-titles";
import { taskSetupOf, type TaskSetup } from "./setup";
import { finishTaskStart } from "./start";
import { isRemoteHost } from "../hosts";
import { DEFAULT_START_VIEW, type StartView } from "../sessions/launch";
import { viewOf } from "./move-targets";
import { isMirror, startRemoteTask } from "./remote";
import { remoteTaskViews } from "./remote-views";
import { chatStateNow } from "../chat/runner";
import { saidSinceLastMessage } from "../chat/store";

export * from "./state";
export { codeReviewRefusal, parseCodeReview } from "./code-review";
export { signOffTask, dropTask, signingOff, mergeSettled } from "./finish";
export { prFor as taskPR } from "./session";
export { moveTask } from "./move-flow";

export interface TaskView {
  id: string;
  name: string;
  prompt: string;
  projectId: string | null;
  projectName: string | null;
  branch: string | null;
  baseBranch: string | null;
  tmuxName: string;
  // How its agent runs; only a terminal task can move for now.
  view: StartView;
  // A running chat's turn, as its worker says ("unknown": unreachable). A
  // linked machine's blocked gate reads it: the derived state hides an open
  // question once a PR is up.
  chatTurn?: ChatTurn | null;
  state: TaskState;
  pr: TaskPR | null;
  // What its last BLOCKED: line asked for, while it's blocked.
  blocked: string | null;
  // The task's card on the project's LumifyHub board, when it has one.
  cardUrl: string | null;
  // Its worktree setup, which the agent waits for; null for older tasks.
  setup: TaskSetup | null;
  createdAt: string;
  // The machine running it, when that's not this one.
  hostId: string | null;
  hostName: string | null;
  // Why that machine couldn't say how it's doing.
  hostError: string | null;
}

export async function createTask(opts: {
  projectId: string;
  prompt: string;
  // Its name; generated from the prompt when absent.
  name?: string;
  model?: string;
  // Started from this LumifyHub card, which the task then moves.
  cardId?: string;
  // Stacked: cut from another task's pushed branch, at this exact commit.
  base?: { branch: string; tip: string; stack: StackedOn };
  // Cut from this branch instead of the default one.
  baseBranch?: string;
  // Called once the session row exists, before the agent launches.
  onCreated?: (sessionId: string) => void;
  // Run it on this machine (another one's own AgentOS); default: the project's.
  hostId?: string;
  // The caller's key for it: a retry with the same id gets the same task.
  id?: string;
  // A queued task's start: clear what an attempt cut off by a restart left
  // (its worktree and branch, when nothing is on them).
  reclaim?: boolean;
  // How its agent runs: as a chat (the default, DEFAULT_START_VIEW) or in
  // a terminal.
  view?: StartView;
}): Promise<Session> {
  if (opts.id) {
    const existing = queries.getSession(db).get(opts.id) as Session | undefined;
    if (existing?.task_status) return existing;
    if (existing) throw new Error("That id is taken");
    if (starting.has(opts.id))
      throw new InProgressError("That task is starting already");
    starting.add(opts.id);
    try {
      return await startTask(opts, opts.id);
    } finally {
      starting.delete(opts.id);
    }
  }
  return startTask(opts, randomUUID());
}

// Whether a session already has this feature's worktree or branch: then
// it's that task's, never a cut-off start's leftover to clear.
export function ownedByATask(
  projectId: string,
  projectPath: string,
  feature: string
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM sessions WHERE worktree_path = ? OR (project_id = ? AND branch_name = ?)`
    )
    .get(
      worktreePathFor(projectPath, feature),
      projectId,
      generateBranchName(feature)
    );
}

// Tasks being started in this process, by the caller's id.
const g = globalThis as unknown as { __agentosStartingTasks?: Set<string> };
const starting = (g.__agentosStartingTasks ??= new Set());

async function startTask(
  opts: Parameters<typeof createTask>[0],
  id: string
): Promise<Session> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Describe the task");
  const project = getProject(opts.projectId);
  if (!project || project.is_uncategorized) throw new Error("Pick a project");
  const hostId = opts.hostId ?? project.host_id;
  const view = opts.view ?? DEFAULT_START_VIEW;
  if (isRemoteHost(hostId)) {
    if (opts.base || opts.cardId)
      throw new Error(
        "Stacked and card tasks run on this machine only for now"
      );
    const session = await startRemoteTask(hostId, project, {
      id,
      prompt,
      name: opts.name,
      model: opts.model,
      baseBranch: opts.baseBranch,
      view,
    });
    opts.onCreated?.(session.id);
    return session;
  }

  if (opts.baseBranch !== undefined && !isBranchName(opts.baseBranch))
    throw new Error(`"${opts.baseBranch}" isn't a branch name`);
  const projectPath = expandHome(project.working_directory);
  const naming = await nameFor(prompt, projectPath, opts.name);
  const feature = `${slugify(naming.name.split(/\s+/).slice(0, 6).join(" "))}-${id.slice(0, 4)}`;
  const baseBranch =
    opts.base?.branch ??
    opts.baseBranch ??
    (await getDefaultBranch(projectPath));
  // A queued start retried after a restart cut it off mid-setup: what it
  // made has no task (createTask returned early if it had one).
  if (opts.reclaim && !ownedByATask(project.id, projectPath, feature))
    await discardLeftoverStart(projectPath, feature);
  const wt = await createWorktree({
    projectPath,
    featureName: feature,
    baseBranch,
    startPoint: opts.base?.tip,
  });

  const provider = getProvider("claude");
  const model = resolveModelForAgent(
    "claude",
    opts.model || project.default_model
  );
  const tmuxName = `${provider.id}-${id}`;

  queries
    .createSession(db)
    .run(
      id,
      naming.name,
      tmuxName,
      wt.worktreePath,
      null,
      model,
      null,
      "sessions",
      "claude",
      1,
      project.id,
      "local"
    );
  queries
    .updateSessionWorktree(db)
    .run(wt.worktreePath, wt.branchName, baseBranch, null, id);
  // Everything the launch needs is on the row, so a restart can resume it.
  db.prepare(
    `UPDATE sessions SET task_prompt = ?, task_brief = ?, task_status = 'running', setup_status = 'running', name_source = ?, view = ? WHERE id = ?`
  ).run(
    prompt,
    buildTaskBrief({
      branch: wt.branchName,
      baseBranch,
      stack: opts.base?.stack,
    }),
    naming.source,
    view,
    id
  );
  opts.onCreated?.(id);
  void naming.refine?.(id);

  // The agent starts once its dependencies are there, so its first check
  // doesn't fail on a module still installing; nothing waits on that here.
  inBackground(`start of task ${id}`, () => finishTaskStart(id));

  const session = queries.getSession(db).get(id) as Session;
  inBackground(`card for task ${id}`, () =>
    attachTaskCard(session, project, opts.cardId)
  );
  return session;
}

// The agent runs under a shell (`zsh -c "...; claude ...; exec $SHELL"`), so
// the pane's command reads as the shell even while the agent works. It has
// exited when the shell is all that's left: nothing running under it. Read
// from the session listing and the shared process table, never a call per
// task; anything unknown reads as still running.
export async function shellOnly(tmuxName: string): Promise<boolean> {
  // Another machine's processes aren't in this one's table.
  if ((statusDetector.hostFor(tmuxName) ?? "local") !== "local") return false;
  const cmd = statusDetector.foregroundFor(tmuxName);
  const pid = statusDetector.paneProcess(tmuxName);
  if (!cmd || !pid || !/^-?(zsh|bash|sh|fish)$/.test(cmd)) return false;
  const rows = await processTable();
  return rows ? !runsSomething(rows, pid) : false;
}

// A chat's turn as its worker says: "unknown" when it can't be reached.
type ChatTurn =
  | NonNullable<Awaited<ReturnType<typeof chatStateNow>>>
  | "unknown";

// A chat between turns waits on the next message, as a terminal at its
// prompt does. One whose worker can't be reached counts as busy.
const chatStatus = (turn: ChatTurn | null): "running" | "waiting" =>
  turn === "running" || turn === "unknown" ? "running" : "waiting";

export async function taskView(session: Session): Promise<TaskView> {
  const live = session.task_status === "running";
  const setup = taskSetupOf(session);
  // A finished task's PR is in the database: only a running one asks gh.
  const chat = session.view === "chat";
  const [pr, chatTurn, screen] = await Promise.all([
    live ? prFor(session) : storedPR(session),
    live && chat
      ? chatStateNow(session.id).catch((): ChatTurn => "unknown")
      : Promise.resolve(null),
    live && !chat
      ? statusDetector.getStatus(session.tmux_name)
      : Promise.resolve(undefined),
  ]);
  const sessionStatus = !live
    ? undefined
    : chat
      ? chatStatus(chatTurn)
      : screen;
  const agentGone =
    !chat && live && sessionStatus !== "dead" && sessionStatus !== undefined
      ? await shellOnly(session.tmux_name)
      : false;
  const blocked =
    live && sessionStatus === "waiting"
      ? blockedReason(
          chat
            ? saidSinceLastMessage(session.id)
            : (await statusDetector.capturePane(session.tmux_name))
                .split("\n")
                .slice(-15)
                .join("\n")
        )
      : null;
  const project = session.project_id ? getProject(session.project_id) : null;
  const state = deriveTaskState({
    taskStatus: session.task_status ?? "running",
    sessionStatus: agentGone ? "dead" : sessionStatus,
    pr,
    blocked: blocked !== null,
    settingUp: setup?.status === "running" || setup?.status === "held",
  });
  syncTaskCardInBackground(session, state, pr);
  return {
    id: session.id,
    name: session.name,
    prompt: session.task_prompt || "",
    projectId: session.project_id,
    projectName: project?.name ?? null,
    branch: session.branch_name,
    baseBranch: session.base_branch,
    tmuxName: session.tmux_name,
    view: viewOf(session),
    chatTurn,
    state,
    pr,
    blocked,
    cardUrl: taskCardUrl(session),
    setup,
    createdAt: session.created_at,
    hostId: null,
    hostName: null,
    hostError: null,
  };
}

/** Tasks this machine handed to another, for that machine's mirror of them. */
export function movedTasks(): { id: string; movedTo: string | null }[] {
  return db
    .prepare(
      `SELECT id, moved_to AS movedTo FROM sessions
         WHERE task_status = 'moved' AND host_id = 'local'
         ORDER BY updated_at DESC LIMIT 500`
    )
    .all() as { id: string; movedTo: string | null }[];
}

// Archived tasks aren't listed.
export async function listTasks(): Promise<TaskView[]> {
  const sessions = taskSessions().filter((s) => !s.archived_at);
  const [local, remote] = await Promise.all([
    Promise.all(sessions.filter((s) => !isMirror(s)).map(taskView)),
    remoteTaskViews(sessions.filter(isMirror)),
  ]);
  return [...local, ...remote].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}
