/**
 * Where an orchestrator may write. Anywhere on the machine except the
 * workspace's project repositories and their task worktrees (code changes go
 * through tasks, so the merge gates keep meaning something), AgentOS's own
 * install and state (all of ~/.agent-os but its own folder), and secret
 * files. Its chat worker checks every Write, Edit and NotebookEdit here
 * before it runs (a PreToolUse hook), on the path with every symlink and
 * `..` resolved the way the system will resolve it.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { isSecretPath } from "../secret-paths";
import { WORKTREES_DIR } from "../worktrees";
import { orchestratorDir } from "./home";

// The tools that write a file, and the argument naming it.
export const WRITE_TOOLS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

export interface WriteBounds {
  // Relative paths are taken from here.
  cwd: string;
  // Its own folder, the one part of `state` it may write.
  ownDir: string;
  // AgentOS's state (~/.agent-os).
  state: string;
  // Project repositories, task worktrees and AgentOS's install.
  repos: string[];
}

const MAX_LINKS = 40;

// The path as the system resolves it: component by component from the root,
// each symlink followed where it sits (a dangling one too, since a write
// creates its target), and `..` taken from the real folder it's in. Parts
// that don't exist yet are kept as named, under the real folder they'd be
// made in.
export async function physicalPath(p: string): Promise<string> {
  const parts = p.split("/").filter(Boolean);
  let at = "/";
  let links = 0;
  while (parts.length) {
    const part = parts.shift()!;
    if (part === ".") continue;
    if (part === "..") {
      at = path.dirname(at);
      continue;
    }
    const next = path.join(at, part);
    const link = await fs.promises.readlink(next).catch(() => null);
    if (link === null) {
      at = next;
      continue;
    }
    if (++links > MAX_LINKS) throw new Error("Too many symlinks");
    parts.unshift(...link.split("/").filter(Boolean));
    if (link.startsWith("/")) at = "/";
  }
  return canonical(at);
}

// Its deepest existing folder as the file system spells it, so a path in
// another case or Unicode form (one folder on macOS) compares equal.
async function canonical(p: string): Promise<string> {
  const rest: string[] = [];
  let at = p;
  for (;;) {
    try {
      return path.join(await fs.promises.realpath(at), ...rest.reverse());
    } catch {
      const up = path.dirname(at);
      if (up === at) return p;
      rest.push(path.basename(at));
      at = up;
    }
  }
}

const FOLDS_CASE =
  process.platform === "darwin" || process.platform === "win32";
const key = (p: string) =>
  FOLDS_CASE ? p.normalize("NFC").toLowerCase() : p.normalize("NFC");

const within = (p: string, root: string) => {
  const [a, b] = [key(p), key(root)];
  return a === b || a.startsWith(b === "/" ? b : b + "/");
};

const expandHome = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir());

// Why a write to this path is refused, or null when it may go ahead.
export async function writeRefusal(
  filePath: string,
  bounds: WriteBounds
): Promise<string | null> {
  if (!filePath) return "No file path to check.";
  const given = expandHome(filePath);
  const abs = given.startsWith("/") ? given : `${bounds.cwd}/${given}`;
  let targets: string[];
  let repos: string[];
  let state: string;
  let ownDir: string;
  try {
    // As written, and with `..` taken by name first, as a tool that
    // normalises the path before opening it would: both must be allowed.
    targets = [
      ...new Set(
        await Promise.all([physicalPath(abs), physicalPath(path.resolve(abs))])
      ),
    ];
    repos = await Promise.all(bounds.repos.map((r) => physicalPath(r)));
    state = await physicalPath(bounds.state);
    ownDir = await physicalPath(bounds.ownDir);
  } catch (e) {
    return `Couldn't resolve ${filePath}: ${(e as Error).message}.`;
  }
  for (const target of targets) {
    const repo = repos.find((r) => within(target, r));
    if (repo)
      return `${filePath} is inside ${repo}, a project repository, task worktree or AgentOS itself. Change code there through a task (start_task), so its PR goes through the merge gates.`;
    if (within(target, state) && !within(target, ownDir))
      return `${filePath} is in AgentOS's own state (${state}); you may write only in your folder, ${ownDir}.`;
    if (isSecretPath(target) || isSecretPath(filePath))
      return `${filePath} holds or guards secrets; orchestrators never write those.`;
  }
  return null;
}

// What an orchestrator's writes are held to, read fresh for each one so a
// project added since counts: every local project's repositories (not just
// its workspace's, since a write to another workspace's repo skips its gates
// as much), every session's worktree, and AgentOS's install and database.
export function orchestratorWriteBounds(session: Session): WriteBounds {
  const projects = db
    .prepare(
      `SELECT working_directory AS dir FROM projects
        WHERE is_uncategorized = 0 AND host_id = 'local'
       UNION SELECT r.path FROM project_repositories r
         JOIN projects p ON p.id = r.project_id
        WHERE p.host_id = 'local'
       UNION SELECT worktree_path FROM sessions
        WHERE worktree_path IS NOT NULL AND worktree_path != ''`
    )
    .all() as { dir: string }[];
  const dbPath = path.resolve(
    process.env.DB_PATH || path.join(process.cwd(), "agent-os.db")
  );
  return {
    cwd: expandHome(session.working_directory),
    ownDir: orchestratorDir(session.workspace_id ?? ""),
    state: path.join(os.homedir(), ".agent-os"),
    repos: [
      ...projects.map((p) => expandHome(p.dir)).filter((d) => d !== ""),
      WORKTREES_DIR,
      process.cwd(),
      path.dirname(dbPath),
    ],
  };
}

// The check a PreToolUse hook makes: why this tool call is refused, or null.
export async function orchestratorToolRefusal(
  session: Session,
  tool: string,
  input: Record<string, unknown>
): Promise<string | null> {
  const arg = WRITE_TOOLS[tool];
  if (!arg) return null;
  const filePath = input[arg];
  if (typeof filePath !== "string") return "No file path to check.";
  return writeRefusal(filePath, orchestratorWriteBounds(session));
}
