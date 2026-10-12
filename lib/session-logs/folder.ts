/**
 * Where a log's markdown file goes. By default
 * ~/.agent-os/session-logs/<workspace>/<project>/YYYY-MM-DD-<task>.md; a
 * project can name its own folder. Never inside the project's repository:
 * repositories can be public, and a log holds briefs and reviews.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../db";
import { slugify } from "../git";
import { getProject, getProjectRepositories } from "../projects";

// AGENTOS_SESSION_LOGS_DIR moves the default (tests keep it off the real one).
export const DEFAULT_ROOT = () =>
  process.env.AGENTOS_SESSION_LOGS_DIR ||
  path.join(os.homedir(), ".agent-os", "session-logs");

const key = (projectId: string) => `session-logs.folder.${projectId}`;

const expand = (p: string) =>
  p === "~" ? os.homedir() : p.replace(/^~(?=\/)/, os.homedir());

// The path with symlinks resolved as far as it exists, so a link into a
// repository is seen for what it is.
function resolved(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.unshift(path.basename(cur));
    cur = up;
  }
  return path.join(fs.realpathSync(cur), ...rest);
}

const within = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

function repoPaths(projectId: string): string[] {
  const project = getProject(projectId);
  if (!project) return [];
  return [
    project.working_directory,
    ...getProjectRepositories(projectId).map((r) => r.path),
  ]
    .filter(Boolean)
    .map((p) => resolved(expand(p)));
}

// Throws a plain message when `dir` is inside one of the project's repos.
export function assertOutsideRepos(projectId: string, dir: string): void {
  const target = resolved(dir);
  const repo = repoPaths(projectId).find((r) => within(target, r));
  if (repo)
    throw new Error(
      `${dir} is inside the project's repository (${repo}). Repositories can be public, so logs are never written into one: choose a folder outside it.`
    );
}

export function logFolder(projectId: string): string | null {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key(projectId)) as { value: string } | undefined;
  return row?.value || null;
}

// Throws on a value that isn't an absolute or ~ path, or that points into
// the project's repository. An empty value goes back to the default.
export function setLogFolder(projectId: string, value: string | null): void {
  const folder = value?.trim() ?? "";
  if (!folder) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key(projectId));
    return;
  }
  if (!getProject(projectId)) throw new Error("Project not found");
  if (!(folder === "~" || folder.startsWith("~/") || path.isAbsolute(folder)))
    throw new Error(
      `"${folder}" isn't an absolute path. Use a full path or one starting with ~/.`
    );
  assertOutsideRepos(projectId, expand(folder));
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key(projectId), folder);
}

export interface FileTarget {
  workspace: string | null;
  project: string | null;
  projectId: string | null;
  name: string;
  id: string;
  // YYYY-MM-DD
  day: string;
}

// The folder this task's log goes into: the project's override when it
// still passes the repository check, else the default.
export function targetDir(t: FileTarget): string {
  const custom = t.projectId ? logFolder(t.projectId) : null;
  if (custom && t.projectId) {
    try {
      const dir = expand(custom);
      assertOutsideRepos(t.projectId, dir);
      return dir;
    } catch (error) {
      console.error(
        `[session-logs] ignoring the project's log folder: ${error instanceof Error ? error.message : error}`
      );
    }
  }
  return path.join(
    DEFAULT_ROOT(),
    slugify(t.workspace ?? "") || "no-workspace",
    slugify(t.project ?? "") || "no-project"
  );
}

// Writes the log once and returns its path. A file that's already there
// (another task, same name, same day) is never overwritten.
export function writeLogFile(t: FileTarget, markdown: string): string {
  const dir = targetDir(t);
  if (t.projectId && !logFolder(t.projectId))
    assertOutsideRepos(t.projectId, dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const slug = slugify(t.name) || t.id.slice(0, 8);
  for (const file of [
    `${t.day}-${slug}.md`,
    `${t.day}-${slug}-${t.id.slice(0, 8)}.md`,
  ]) {
    const full = path.join(dir, file);
    try {
      fs.writeFileSync(full, markdown, { flag: "wx", mode: 0o600 });
      return full;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`a log file for ${t.name} already exists in ${dir}`);
}
