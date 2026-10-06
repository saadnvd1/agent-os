/**
 * Async tasks: a prompt becomes an agent working alone in its own worktree,
 * which ends by opening a PR. A human signs off (squash-merge + cleanup) or
 * drops it.
 */

import { randomUUID } from "crypto";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import { createWorktree } from "../worktrees";
import { setupWorktree } from "../env-setup";
import { getDefaultBranch, slugify } from "../git";
import { runInBackground } from "../async-operations";
import { resolveModelForAgent } from "../model-catalog";
import { getProvider } from "../providers";
import { launchClaude } from "../agents/launch";
import { statusDetector } from "../status-detector";
import { buildTaskBrief, type StackedOn } from "./brief";
import { run } from "./gh";
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
import { expandHome, prFor, taskSessions } from "./session";

export * from "./state";
export { signOffTask, dropTask, signingOff, mergeSettled } from "./finish";
export { prFor as taskPR } from "./session";

export interface TaskView {
  id: string;
  name: string;
  prompt: string;
  projectId: string | null;
  projectName: string | null;
  branch: string | null;
  baseBranch: string | null;
  tmuxName: string;
  state: TaskState;
  pr: TaskPR | null;
  // What its last BLOCKED: line asked for, while it's blocked.
  blocked: string | null;
  // The task's card on the project's LumifyHub board, when it has one.
  cardUrl: string | null;
  createdAt: string;
}

function taskTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

export async function createTask(opts: {
  projectId: string;
  prompt: string;
  model?: string;
  // Started from this LumifyHub card, which the task then moves.
  cardId?: string;
  // Stacked: cut from another task's pushed branch, at this exact commit.
  base?: { branch: string; tip: string; stack: StackedOn };
  // Called once the session row exists, before the agent launches.
  onCreated?: (sessionId: string) => void;
}): Promise<Session> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Describe the task");
  const project = getProject(opts.projectId);
  if (!project || project.is_uncategorized) throw new Error("Pick a project");
  if (project.host_id && project.host_id !== "local") {
    throw new Error("Tasks run on this machine only for now");
  }

  const projectPath = expandHome(project.working_directory);
  const id = randomUUID();
  const feature = `${slugify(prompt.split(/\s+/).slice(0, 6).join(" "))}-${id.slice(0, 4)}`;
  const baseBranch = opts.base?.branch ?? (await getDefaultBranch(projectPath));
  const wt = await createWorktree({
    projectPath,
    featureName: feature,
    baseBranch,
    startPoint: opts.base?.tip,
  });

  runInBackground(async () => {
    await setupWorktree({
      worktreePath: wt.worktreePath,
      sourcePath: projectPath,
    });
  }, `setup-task-${id}`);

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
      taskTitle(prompt),
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
  db.prepare(
    `UPDATE sessions SET task_prompt = ?, task_status = 'running' WHERE id = ?`
  ).run(prompt, id);
  opts.onCreated?.(id);

  await launchClaude({
    sessionId: id,
    tmuxName,
    cwd: wt.worktreePath,
    model,
    prompt,
    brief: buildTaskBrief({
      branch: wt.branchName,
      baseBranch,
      stack: opts.base?.stack,
    }),
  });

  const session = queries.getSession(db).get(id) as Session;
  inBackground(`card for task ${id}`, () =>
    attachTaskCard(session, project, opts.cardId)
  );
  return session;
}

// The agent runs under a shell (`zsh -c "...; claude ...; exec $SHELL"`), so
// the pane's command reads as the shell even while the agent works. It has
// exited when the shell is all that's left: no child process under it.
async function shellOnly(tmuxName: string): Promise<boolean> {
  try {
    const out = await run(
      "tmux",
      [
        "display-message",
        "-t",
        `=${tmuxName}:`,
        "-p",
        "#{pane_current_command} #{pane_pid}",
      ],
      "/"
    );
    const [cmd, pid] = out.trim().split(" ");
    if (!/^-?(zsh|bash|sh|fish)$/.test(cmd)) return false;
    const children = await run("pgrep", ["-P", pid], "/").catch(() => "");
    return children.trim() === "";
  } catch {
    return false;
  }
}

export async function taskView(session: Session): Promise<TaskView> {
  const live = session.task_status === "running";
  const [pr, sessionStatus] = await Promise.all([
    prFor(session),
    live
      ? statusDetector.getStatus(session.tmux_name)
      : Promise.resolve(undefined),
  ]);
  const agentGone =
    live && sessionStatus !== "dead" && sessionStatus !== undefined
      ? await shellOnly(session.tmux_name)
      : false;
  const blocked =
    live && sessionStatus === "waiting"
      ? blockedReason(
          (await statusDetector.capturePane(session.tmux_name))
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
    state,
    pr,
    blocked,
    cardUrl: taskCardUrl(session),
    createdAt: session.created_at,
  };
}

export async function listTasks(): Promise<TaskView[]> {
  return Promise.all(taskSessions().map(taskView));
}
