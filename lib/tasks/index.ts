/**
 * Async tasks: a prompt becomes an agent working alone in its own worktree,
 * which ends by opening a PR. A human signs off (squash-merge + cleanup) or
 * drops it.
 */

import { randomUUID } from "crypto";
import os from "os";
import { db, queries, type Session } from "../db";
import { getProject } from "../projects";
import { createWorktree, deleteWorktree } from "../worktrees";
import { setupWorktree } from "../env-setup";
import { getDefaultBranch, slugify } from "../git";
import { runInBackground } from "../async-operations";
import { resolveModelForAgent } from "../model-catalog";
import { getProvider } from "../providers";
import { launchClaude } from "../agents/launch";
import { statusDetector } from "../status-detector";
import { buildTaskBrief } from "./brief";
import { findPR, run } from "./gh";
import {
  canSignOff,
  deriveTaskState,
  isBlocked,
  type TaskPR,
  type TaskState,
} from "./state";

export * from "./state";

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
  createdAt: string;
}

const expandHome = (p: string) => p.replace(/^~/, os.homedir());

function taskTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

export async function createTask(opts: {
  projectId: string;
  prompt: string;
  model?: string;
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
  const baseBranch = await getDefaultBranch(projectPath);
  const wt = await createWorktree({
    projectPath,
    featureName: feature,
    baseBranch,
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

  await launchClaude({
    sessionId: id,
    tmuxName,
    cwd: wt.worktreePath,
    model,
    prompt,
    brief: buildTaskBrief({ branch: wt.branchName, baseBranch }),
  });

  return queries.getSession(db).get(id) as Session;
}

function taskSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM sessions WHERE task_status IS NOT NULL ORDER BY created_at DESC`
    )
    .all() as Session[];
}

function projectPathFor(session: Session): string | null {
  if (!session.project_id) return null;
  const project = getProject(session.project_id);
  return project ? expandHome(project.working_directory) : null;
}

const prCache = new Map<string, { at: number; pr: TaskPR | null }>();

async function prFor(session: Session, fresh = false): Promise<TaskPR | null> {
  const repo = projectPathFor(session);
  if (!repo || !session.branch_name) return null;
  const cached = prCache.get(session.id);
  if (!fresh && cached && Date.now() - cached.at < 20000) return cached.pr;
  const pr = await findPR(repo, session.branch_name);
  prCache.set(session.id, { at: Date.now(), pr });
  if (pr) {
    db.prepare(
      `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ? WHERE id = ?`
    ).run(pr.url, pr.number, pr.state.toLowerCase(), session.id);
  }
  return pr;
}

// The agent runs in front of a shell; when only the shell is left it exited.
async function shellOnly(tmuxName: string): Promise<boolean> {
  try {
    const cmd = await run(
      "tmux",
      [
        "display-message",
        "-t",
        `=${tmuxName}:`,
        "-p",
        "#{pane_current_command}",
      ],
      "/"
    );
    return /^-?(zsh|bash|sh|fish)$/.test(cmd.trim());
  } catch {
    return false;
  }
}

async function viewOf(session: Session): Promise<TaskView> {
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
      ? isBlocked(
          (await statusDetector.capturePane(session.tmux_name))
            .split("\n")
            .slice(-15)
            .join("\n")
        )
      : false;
  const project = session.project_id ? getProject(session.project_id) : null;
  return {
    id: session.id,
    name: session.name,
    prompt: session.task_prompt || "",
    projectId: session.project_id,
    projectName: project?.name ?? null,
    branch: session.branch_name,
    baseBranch: session.base_branch,
    tmuxName: session.tmux_name,
    state: deriveTaskState({
      taskStatus: session.task_status ?? "running",
      sessionStatus: agentGone ? "dead" : sessionStatus,
      pr,
      blocked,
    }),
    pr,
    createdAt: session.created_at,
  };
}

export async function listTasks(): Promise<TaskView[]> {
  return Promise.all(taskSessions().map(viewOf));
}

function getTaskSession(id: string): Session {
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session?.task_status) throw new Error("Task not found");
  return session;
}

async function cleanup(session: Session, repo: string): Promise<void> {
  await run(
    "tmux",
    ["kill-session", "-t", `=${session.tmux_name}`],
    repo
  ).catch(() => {});
  if (session.worktree_path) {
    await deleteWorktree(session.worktree_path, repo, true).catch(() => {});
  }
  if (session.branch_name) {
    await run(
      "git",
      ["push", "origin", "--delete", session.branch_name],
      repo
    ).catch(() => {});
  }
  await run("git", ["fetch", "--prune", "--quiet"], repo).catch(() => {});
  prCache.delete(session.id);
}

// Squash-merge the PR, then remove the session, worktree and branches.
// The checks are re-read here: the button is not the guard.
export async function signOffTask(id: string): Promise<void> {
  const session = getTaskSession(id);
  if (session.task_status !== "running")
    throw new Error(`Task is already ${session.task_status}`);
  const repo = projectPathFor(session);
  if (!repo) throw new Error("Task has no project");
  const pr = await prFor(session, true);
  const verdict = canSignOff(pr);
  if (!verdict.ok) throw new Error(verdict.reason);
  await run(
    "gh",
    ["pr", "merge", String(pr!.number), "--squash"],
    repo,
    120000
  );
  db.prepare(
    `UPDATE sessions SET task_status = 'merged', pr_status = 'merged' WHERE id = ?`
  ).run(id);
  await cleanup(session, repo);
}

// Reject the work: close the PR if there is one and remove everything.
export async function dropTask(id: string): Promise<void> {
  const session = getTaskSession(id);
  if (session.task_status !== "running")
    throw new Error(`Task is already ${session.task_status}`);
  const repo = projectPathFor(session);
  if (!repo) throw new Error("Task has no project");
  const pr = await prFor(session, true);
  if (pr?.state === "OPEN") {
    await run("gh", ["pr", "close", String(pr.number)], repo).catch(() => {});
  }
  db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
    id
  );
  await cleanup(session, repo);
}
