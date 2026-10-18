/**
 * Where a log's markdown file goes, first match wins: the project's own
 * folder, then the workspace's HQ repo (<hq>/docs/sessions/<project>/), then
 * ~/.agent-os/session-logs/<workspace>/<project>/. All as
 * YYYY-MM-DD-<task>.md. Never inside the project's repository: repositories
 * can be public, and a log holds briefs and reviews.
 */

import { agentosHome } from "../agentos-home";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { slugify } from "../git";
import { getProject } from "../projects";
import { usableHq, type Visibility } from "./hq";
import { expand, repoPaths, resolved, within } from "./paths";

// AGENTOS_SESSION_LOGS_DIR moves the default (tests keep it off the real one).
export const DEFAULT_ROOT = () =>
  process.env.AGENTOS_SESSION_LOGS_DIR || agentosHome("session-logs");

const key = (projectId: string) => `session-logs.folder.${projectId}`;

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
  workspaceId?: string | null;
  project: string | null;
  projectId: string | null;
  name: string;
  id: string;
  // YYYY-MM-DD
  day: string;
}

export interface Destination {
  dir: string;
  // The HQ repo the folder belongs to, when the log goes into one.
  hq: { dir: string; visibility: Visibility } | null;
}

// The folder this task's log goes into: the project's override when it
// still passes the repository check, else the workspace's HQ, else the
// default.
export function destination(t: FileTarget): Destination {
  const projectSlug = slugify(t.project ?? "") || "no-project";
  const custom = t.projectId ? logFolder(t.projectId) : null;
  if (custom && t.projectId) {
    try {
      const dir = expand(custom);
      assertOutsideRepos(t.projectId, dir);
      return { dir, hq: null };
    } catch (error) {
      console.error(
        `[session-logs] ignoring the project's log folder: ${error instanceof Error ? error.message : error}`
      );
    }
  }
  const workspaceId =
    t.workspaceId ??
    (t.projectId ? getProject(t.projectId)?.workspace_id : null) ??
    null;
  const hq = workspaceId ? usableHq(workspaceId) : null;
  if (hq)
    return { dir: path.join(hq.dir, "docs", "sessions", projectSlug), hq };
  return {
    dir: path.join(
      DEFAULT_ROOT(),
      slugify(t.workspace ?? "") || "no-workspace",
      projectSlug
    ),
    hq: null,
  };
}

export const targetDir = (t: FileTarget): string => destination(t).dir;

// Writes the log once and returns its path. A file that's already there
// (another task, same name, same day) is never overwritten.
export function writeLogFileTo(
  t: FileTarget,
  markdown: string
): { file: string; hq: Destination["hq"] } {
  const { dir, hq } = destination(t);
  if (t.projectId && !logFolder(t.projectId) && !hq)
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
      return { file: full, hq };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`a log file for ${t.name} already exists in ${dir}`);
}

export const writeLogFile = (t: FileTarget, markdown: string): string =>
  writeLogFileTo(t, markdown).file;

// Rewrites a log's own file in place (never creates one, never moves it).
export function overwriteLogFile(file: string, markdown: string): void {
  if (fs.existsSync(file)) fs.writeFileSync(file, markdown, { mode: 0o600 });
}
