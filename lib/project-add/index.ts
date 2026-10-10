/**
 * Adding a project on any machine: open a folder on it, clone a repository
 * into it, or start a new one from a name (folder, git init, first commit).
 */

import path from "path";
import { randomUUID } from "crypto";
import { createProject, type ProjectWithRepositories } from "../projects";
import { getHost } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { run, shellPath, spawnOn } from "./shell";
import { onWindowsDrive, WINDOWS_DRIVE_WARNING } from "../wsl";

export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
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
    `cd ${shellPath(dir || "~")} && pwd && { test -e .git && echo GIT || echo NOGIT; } && find . -mindepth 1 -maxdepth 1 -type d ! -name '.*' 2>/dev/null | sort | head -500`
  );
  const [abs, git, ...rest] = out.split("\n");
  return {
    path: abs,
    parent: abs === "/" ? null : path.posix.dirname(abs),
    folders: rest.filter(Boolean).map((f) => f.replace(/^\.\//, "")),
    isGitRepo: git === "GIT",
    warning: onWindowsDrive(abs) ? WINDOWS_DRIVE_WARNING : null,
  };
}

export async function addFolder(
  hostId: string,
  dir: string
): Promise<ProjectWithRepositories> {
  const { path: abs } = await listFolders(hostId, dir);
  return createProject({
    name: path.posix.basename(abs) || "project",
    workingDirectory: abs,
    hostId,
  });
}

// A machine with no git identity still gets its first commit, under a
// name set on this repo only.
const IDENTITY =
  "{ git config user.email >/dev/null || git config user.email agentos@localhost; } && { git config user.name >/dev/null || git config user.name AgentOS; }";

// A new folder under `parent`, a git repo with a first commit.
export async function initProject(
  hostId: string,
  parent: string,
  name: string
): Promise<ProjectWithRepositories> {
  checkHost(hostId);
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
  url: string
): CloneJob {
  checkHost(hostId);
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
