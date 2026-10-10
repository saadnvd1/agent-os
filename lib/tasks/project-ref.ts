/**
 * The same project on another machine: found by its repository (the git
 * remote), then by its folder relative to ~, and cloned there when neither
 * exists. Works for any project, not just AgentOS.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createProject, getAllProjects } from "../projects";
import { isRemoteHost } from "../hosts";
import type { Project } from "../db";
import { run } from "./gh";
import { expandHome } from "./session";

export interface ProjectRef {
  name: string;
  // Relative to ~, like "dev/app".
  path: string;
  // The origin remote's URL; null when the repo has none.
  remote: string | null;
}

const execFileAsync = promisify(execFile);

/** A ref as another machine sent it: its shape, before anything reads it. */
export function isProjectRef(v: unknown): v is ProjectRef {
  const r = v as ProjectRef | null;
  return (
    !!r &&
    typeof r === "object" &&
    typeof r.name === "string" &&
    typeof r.path === "string" &&
    (r.remote === null || typeof r.remote === "string")
  );
}

const REMOTE_URL = /^(https:\/\/|ssh:\/\/|git@)[\w.@:/~-]+$/;

export function homeRelative(dir: string, home = os.homedir()): string {
  const abs = path.resolve(expandHome(dir));
  if (abs !== home && !abs.startsWith(home + path.sep))
    throw new Error(`${dir} isn't inside your home folder`);
  return path.relative(home, abs);
}

export function safeRelative(rel: string): string {
  const clean = path.normalize(rel);
  if (!rel || path.isAbsolute(rel) || clean.startsWith("..") || clean === ".")
    throw new Error(`Bad project folder: ${rel}`);
  return clean;
}

/** github.com/owner/repo, however the URL was written. */
export function repoIdentity(remote: string | null): string | null {
  if (!remote) return null;
  const m = remote
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .match(/^(?:https:\/\/|ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+)$/);
  return m ? `${m[1].toLowerCase()}/${m[2].toLowerCase()}` : null;
}

export async function originOf(dir: string): Promise<string | null> {
  const url = await run("git", ["remote", "get-url", "origin"], dir).catch(
    () => ""
  );
  return url.trim() || null;
}

/**
 * A remote without the credentials some origins carry
 * (https://x-access-token:ghp_…@github.com/…): a ref goes to other
 * machines, and into their git command lines. ssh keeps its user (git@).
 */
export function withoutCredentials(remote: string | null): string | null {
  if (!remote) return remote;
  return remote
    .replace(/^(https?:\/\/)[^@/]*@/i, "$1")
    .replace(/^(ssh:\/\/)([^@/:]*):[^@/]*@/i, "$1$2@");
}

export async function projectRef(project: Project): Promise<ProjectRef> {
  const dir = expandHome(project.working_directory);
  return {
    name: project.name,
    path: homeRelative(dir),
    remote: withoutCredentials(await originOf(dir)),
  };
}

async function findProject(ref: ProjectRef): Promise<Project | null> {
  const mine = getAllProjects().filter(
    (p) => !p.is_uncategorized && !isRemoteHost(p.host_id)
  );
  const want = repoIdentity(ref.remote);
  if (want) {
    for (const p of mine) {
      const dir = expandHome(p.working_directory);
      if (!fs.existsSync(dir)) continue;
      if (repoIdentity(await originOf(dir)) === want) return p;
    }
  }
  const abs = path.join(os.homedir(), safeRelative(ref.path));
  return (
    mine.find((p) => path.resolve(expandHome(p.working_directory)) === abs) ??
    null
  );
}

/** This machine's project for a ref, cloning the repository if it must. */
export async function ensureProject(ref: ProjectRef): Promise<Project> {
  const found = await findProject(ref);
  if (found) return found;
  const dir = path.join(os.homedir(), safeRelative(ref.path));
  if (!fs.existsSync(path.join(dir, ".git"))) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0)
      throw new Error(`${dir} exists here but isn't a git repository`);
    if (!ref.remote || !REMOTE_URL.test(ref.remote))
      throw new Error(`${ref.name} isn't here and has no remote to clone`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    await run("git", ["clone", "--", ref.remote, dir], os.homedir(), 600000);
  }
  return createProject({
    name: ref.name || path.basename(dir),
    workingDirectory: `~/${path.relative(os.homedir(), dir)}`,
  });
}

/**
 * Why this machine can't find or clone a ref's project, without cloning
 * it (a clone check asks the remote, never prompting); null when it can.
 */
export async function whyNotHere(ref: ProjectRef): Promise<string | null> {
  let dir: string;
  try {
    if (await findProject(ref)) return null;
    dir = path.join(os.homedir(), safeRelative(ref.path));
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (fs.existsSync(path.join(dir, ".git"))) return null;
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0)
    return "Its folder there isn't a git repository";
  const remote = withoutCredentials(ref.remote);
  if (!remote || !REMOTE_URL.test(remote))
    return "Not there, and no remote to clone";
  try {
    await execFileAsync("git", ["ls-remote", "--heads", "--", remote], {
      cwd: os.homedir(),
      timeout: 15000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
      },
    });
    return null;
  } catch {
    return "Can't clone it there";
  }
}
