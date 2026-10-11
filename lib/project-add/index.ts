/**
 * Adding a project on any machine: open a folder on it, clone a repository
 * into it, or start a new one from a name (folder, git init, first commit).
 */

import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import {
  createProject,
  getProject,
  getProjectWithDevServers,
  type ProjectWithRepositories,
} from "../projects";
import { db, queries, type Project } from "../db";
import { getHost } from "../hosts";
import { getWorkspace, setProjectWorkspace } from "../workspaces";
import { shellQuote } from "../hosts/ssh";
import { run, shellPath, spawnOn } from "./shell";
import { onWindowsDrive, WINDOWS_DRIVE_WARNING } from "../wsl";

import { PROJECT_NAME } from "./name";

export { PROJECT_NAME };
// https://host/owner/repo(.git), ssh://…, or git@host:owner/repo(.git).
const REPO_URL =
  /^(?:https:\/\/[\w.-]+(?::\d+)?\/|ssh:\/\/[\w.@-]+(?::\d+)?\/|[\w.-]+@[\w.-]+:)[\w./~-]+$/;

function checkHost(hostId: string) {
  if (!getHost(hostId)) throw new Error("Unknown machine");
}

export interface FolderListing {
  path: string;
  parent: string | null;
  folders: string[];
  isGitRepo: boolean;
  // The folder with every symlink resolved, for the secrets check.
  realPath: string;
  // Set when the folder is somewhere a project shouldn't live (a Windows
  // drive under WSL).
  warning: string | null;
}

// One folder's subfolders (hidden ones left out), for picking a project.
export async function listFolders(
  hostId: string,
  dir: string
): Promise<FolderListing> {
  checkHost(hostId);
  const out = await run(
    hostId,
    `cd ${shellPath(dir || "~")} && pwd && pwd -P && { test -e .git && echo GIT || echo NOGIT; } && find . -mindepth 1 -maxdepth 1 -type d ! -name '.*' 2>/dev/null | sort | head -500`
  );
  const [abs, real, git, ...rest] = out.split("\n");
  return {
    path: abs,
    parent: abs === "/" ? null : path.posix.dirname(abs),
    folders: rest.filter(Boolean).map((f) => f.replace(/^\.\//, "")),
    isGitRepo: git === "GIT",
    realPath: real,
    warning: onWindowsDrive(abs) ? WINDOWS_DRIVE_WARNING : null,
  };
}

function checkWorkspace(workspaceId: string | null | undefined) {
  if (workspaceId && !getWorkspace(workspaceId))
    throw new Error("Unknown workspace");
}

// Folders that hold keys and credentials are never a project's home.
const SECRET_DIR =
  /(^|\/)(\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.password-store|\.agent-os|Keychains|tokenvault)(\/|$)/i;

export function isSecretPath(dir: string): boolean {
  const p = dir.replace(os.homedir(), "~");
  return SECRET_DIR.test(p) || /^~\/\.config(\/|$)/i.test(p);
}

const folderKey = (hostId: string, dir: string) => {
  const abs =
    hostId === "local" ? dir.replace(/^~(?=$|\/)/, os.homedir()) : dir;
  return `${hostId}\0${abs.replace(/\/+$/, "") || "/"}`;
};

// The project that already lives in this folder on this machine, if any.
export function projectAt(hostId: string, dir: string): Project | null {
  const key = folderKey(hostId, dir);
  const row = (
    queries.getProjectFolders(db).all() as {
      id: string;
      host_id: string;
      working_directory: string;
      is_uncategorized: number;
    }[]
  ).find(
    (p) =>
      !p.is_uncategorized &&
      folderKey(p.host_id || "local", p.working_directory) === key
  );
  return (row && getProject(row.id)) || null;
}

// Adding a folder that's already a project: the caller is told which, and
// can ask again with moveExisting to bring it into the workspace instead.
export class ProjectExistsError extends Error {
  constructor(readonly project: Project) {
    super(`${project.name} is already a project`);
  }
}

export interface AddFolderOptions {
  workspaceId?: string | null;
  name?: string;
  // An existing project at the folder moves into workspaceId rather than
  // failing.
  moveExisting?: boolean;
  // ...but only one in no workspace: taking a project from another
  // workspace is refused (the orchestrator's limit).
  moveOnlyUnassigned?: boolean;
  requireGit?: boolean;
}

export interface AddedFolder {
  project: ProjectWithRepositories;
  // What happened: made, or an existing one moved (from its old
  // workspace) or already there.
  outcome: "created" | "moved" | "unchanged";
  from: string | null;
}

// The one way a folder becomes a project in a workspace, for the add
// dialog and the orchestrator's add_project alike.
export async function addFolder(
  hostId: string,
  dir: string,
  opts: AddFolderOptions = {}
): Promise<AddedFolder> {
  checkHost(hostId);
  checkWorkspace(opts.workspaceId);
  if (isSecretPath(dir)) throw new Error("That folder holds secrets");
  const { path: abs, realPath, isGitRepo } = await listFolders(hostId, dir);
  if (isSecretPath(abs) || isSecretPath(realPath))
    throw new Error("That folder holds secrets");
  if (opts.requireGit && !isGitRepo)
    throw new Error(`${abs} isn't a git repository`);
  const workspaceId = opts.workspaceId ?? null;
  const existing = projectAt(hostId, abs) ?? projectAt(hostId, realPath);
  if (existing) {
    if (!opts.moveExisting) throw new ProjectExistsError(existing);
    const from = existing.workspace_id;
    if (opts.moveOnlyUnassigned && from && from !== workspaceId)
      throw new Error(
        `${existing.name} belongs to the ${getWorkspace(from)?.name ?? "another"} workspace; only Saad moves a project between workspaces`
      );
    const outcome =
      !workspaceId || from === workspaceId ? "unchanged" : "moved";
    if (outcome === "moved") setProjectWorkspace(existing.id, workspaceId);
    return {
      project: getProjectWithDevServers(existing.id) as ProjectWithRepositories,
      outcome,
      from,
    };
  }
  const name = opts.name?.trim() || path.posix.basename(abs) || "project";
  return {
    project: createProject({
      name,
      workingDirectory: abs,
      hostId,
      workspaceId,
    }),
    outcome: "created",
    from: null,
  };
}

// A machine with no git identity still gets its first commit, under a
// name set on this repo only.
const IDENTITY =
  "{ git config user.email >/dev/null || git config user.email agentos@localhost; } && { git config user.name >/dev/null || git config user.name AgentOS; }";

// A new folder under `parent`, a git repo with a first commit.
export async function initProject(
  hostId: string,
  parent: string,
  name: string,
  workspaceId: string | null = null
): Promise<ProjectWithRepositories> {
  checkHost(hostId);
  checkWorkspace(workspaceId);
  if (!PROJECT_NAME.test(name))
    throw new Error("Use letters, numbers, dots, dashes or underscores");
  const out = await run(
    hostId,
    `cd ${shellPath(parent || "~")} && mkdir ${shellQuote(name)} && cd ${shellQuote(name)} && git init -q && ${IDENTITY} && printf '# %s\\n' ${shellQuote(name)} > README.md && git add README.md && git commit -qm 'Initial commit' && pwd`
  );
  return createProject({
    name,
    workingDirectory: out.trim().split("\n").pop() || name,
    hostId,
    workspaceId,
  });
}

export function repoNameOf(url: string): string | null {
  const name = url
    .replace(/\/+$/, "")
    .split(/[/:]/)
    .pop()
    ?.replace(/\.git$/, "");
  return name && PROJECT_NAME.test(name) ? name : null;
}

export interface CloneJob {
  id: string;
  status: "running" | "done" | "failed";
  // The last lines git printed (its progress).
  log: string[];
  error: string | null;
  projectId: string | null;
}

const g = globalThis as { __agentosClones?: Map<string, CloneJob> };
const jobs = (g.__agentosClones ??= new Map());
const LOG_LINES = 30;
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CLONES = 4;
const KEEP_FINISHED_MS = 10 * 60 * 1000;

export const getCloneJob = (id: string) => jobs.get(id) ?? null;

// Clones in the background; the job reports git's progress and, once
// done, the project it made.
export function startClone(
  hostId: string,
  parent: string,
  url: string,
  workspaceId: string | null = null
): CloneJob {
  checkHost(hostId);
  checkWorkspace(workspaceId);
  if (!REPO_URL.test(url)) throw new Error("That isn't a repository URL");
  const name = repoNameOf(url);
  if (!name) throw new Error("Couldn't tell the repository's name");
  if (
    [...jobs.values()].filter((j) => j.status === "running").length >=
    MAX_CLONES
  )
    throw new Error("Too many clones running; try again when one finishes");
  const job: CloneJob = {
    id: randomUUID(),
    status: "running",
    log: [],
    error: null,
    projectId: null,
  };
  jobs.set(job.id, job);
  const target = `${shellPath(parent || "~")}/${shellQuote(name)}`;
  const child = spawnOn(
    hostId,
    `GIT_TERMINAL_PROMPT=0 git clone --progress -- ${shellQuote(url)} ${target} && cd ${target} && pwd`
  );
  // A clone that hangs (a host key prompt, a dead remote) is given up on.
  const timer = setTimeout(() => child.kill(), CLONE_TIMEOUT_MS);
  let stdout = "";
  child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
  // Progress redraws its line with \r; keep each line's latest state.
  child.stderr?.on("data", (d: Buffer) => {
    for (const line of d.toString().split(/\r|\n/)) {
      const text = line.trim();
      if (!text) continue;
      const last = job.log[job.log.length - 1];
      if (last && text.split(":")[0] === last.split(":")[0])
        job.log[job.log.length - 1] = text;
      else job.log.push(text);
    }
    job.log.splice(0, Math.max(0, job.log.length - LOG_LINES));
  });
  // A finished job is read by its dialog's next poll or two, then dropped.
  const forget = () =>
    setTimeout(() => jobs.delete(job.id), KEEP_FINISHED_MS).unref?.();
  child.on("error", (error) => {
    clearTimeout(timer);
    forget();
    job.status = "failed";
    job.error = error.message;
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    forget();
    if (job.status !== "running") return;
    if (code !== 0) {
      job.status = "failed";
      job.error = job.log[job.log.length - 1] ?? `git exited with ${code}`;
      return;
    }
    try {
      const project = createProject({
        name,
        workingDirectory: stdout.trim().split("\n").pop() || name,
        hostId,
        workspaceId,
      });
      job.projectId = project.id;
      job.status = "done";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
  });
  return job;
}

// Publishes a project as a private GitHub repository, only when asked.
export async function publishPrivate(
  hostId: string,
  dir: string
): Promise<string> {
  checkHost(hostId);
  const name = path.posix
    .basename(dir)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  if (!PROJECT_NAME.test(name)) throw new Error("Not a repository name");
  const out = await run(
    hostId,
    `cd ${shellPath(dir)} && gh repo create ${shellQuote(name)} --private --source . --push`,
    120_000
  );
  return (
    out
      .trim()
      .split("\n")
      .find((l) => l.startsWith("https://")) ?? ""
  );
}
