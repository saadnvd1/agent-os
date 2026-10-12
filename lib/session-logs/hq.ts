/**
 * A workspace's HQ folder: a git repo that session logs are written into
 * (<hq>/docs/sessions/<project>/) and committed to. Logs hold private task
 * details, so a repo whose remote is public is refused when it's saved, and
 * nothing is pushed unless the stored visibility says private.
 */

import fs from "fs";
import path from "path";
import { db } from "../db";
import { git } from "../git-exec";
import { run } from "../tasks/gh";
import { getWorkspace } from "../workspaces";
import { expand, repoPaths, resolved, within } from "./paths";

export type Visibility = "private" | "internal" | "none";

export interface Hq {
  folder: string;
  // "none": the repo has no remote, so its logs stay local.
  visibility: Visibility;
}

const key = (workspaceId: string) => `session-logs.hq.${workspaceId}`;

export function getHq(workspaceId: string): Hq | null {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key(workspaceId)) as { value: string } | undefined;
  if (!row) return null;
  try {
    const hq = JSON.parse(row.value) as Hq;
    return hq.folder ? hq : null;
  } catch {
    return null;
  }
}

function projectRepos(workspaceId: string): string[] {
  const ids = db
    .prepare(`SELECT id FROM projects WHERE workspace_id = ?`)
    .all(workspaceId) as { id: string }[];
  return ids.flatMap((p) => repoPaths(p.id));
}

const insideRepo = (hq: string, workspaceId: string) =>
  projectRepos(workspaceId).find((r) => within(hq, r));

// The HQ when logs can still go into it: it's there, it's a git
// repo and no project's repository has swallowed it since it was saved.
export function usableHq(
  workspaceId: string
): { dir: string; visibility: Visibility } | null {
  const hq = getHq(workspaceId);
  if (!hq) return null;
  try {
    const dir = resolved(expand(hq.folder));
    if (!fs.existsSync(path.join(dir, ".git")) || insideRepo(dir, workspaceId))
      throw new Error("not usable");
    return { dir, visibility: hq.visibility };
  } catch {
    console.error(
      `[session-logs] the HQ folder ${hq.folder} can't be used; logs go to the default`
    );
    return null;
  }
}

export interface HqDeps {
  // gh's answer for the repo at `dir`: PUBLIC, PRIVATE or INTERNAL.
  visibility: (dir: string) => Promise<string>;
}

const ghVisibility = async (dir: string) =>
  (
    await run(
      "gh",
      ["repo", "view", "--json", "visibility", "-q", ".visibility"],
      dir,
      20_000
    )
  ).trim();

// Saves the HQ folder, or throws a plain message saying why not. An empty
// value clears it.
export async function setHq(
  workspaceId: string,
  value: string | null,
  deps: HqDeps = { visibility: ghVisibility }
): Promise<void> {
  if (!getWorkspace(workspaceId)) throw new Error("Workspace not found");
  const folder = value?.trim() ?? "";
  if (!folder) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key(workspaceId));
    return;
  }
  if (!(folder === "~" || folder.startsWith("~/") || path.isAbsolute(folder)))
    throw new Error(
      `"${folder}" isn't an absolute path. Use a full path or one starting with ~/.`
    );
  const dir = resolved(expand(folder));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
    throw new Error(`${folder} isn't a folder.`);
  let top: string;
  try {
    top = resolved((await git(dir, ["rev-parse", "--show-toplevel"])).trim());
  } catch {
    throw new Error(`${folder} isn't a git repository.`);
  }
  if (top !== dir)
    throw new Error(
      `${folder} is inside the git repository at ${top}. Give the repository's top folder.`
    );
  const repo = insideRepo(dir, workspaceId);
  if (repo)
    throw new Error(
      `${folder} is inside a project's repository (${repo}). Repositories can be public, so logs are never written into one.`
    );
  let visibility: Visibility = "none";
  if ((await git(dir, ["remote"])).trim()) {
    let seen: string;
    try {
      seen = (await deps.visibility(dir)).toUpperCase();
    } catch (error) {
      throw new Error(
        `Couldn't check whether ${folder}'s GitHub repository is private: ${error instanceof Error ? error.message : error}`
      );
    }
    if (seen === "PUBLIC")
      throw new Error(
        `${folder}'s GitHub repository is public. Logs hold private task details, so use a private repository.`
      );
    if (seen !== "PRIVATE" && seen !== "INTERNAL")
      throw new Error(`Unexpected repository visibility "${seen}".`);
    visibility = seen === "PRIVATE" ? "private" : "internal";
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key(workspaceId), JSON.stringify({ folder, visibility }));
}

// One commit at a time per HQ: two merges at once would race on its index.
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(hq: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(hq) ?? Promise.resolve()).then(job, job);
  const tail = next.catch(() => {});
  queues.set(hq, tail);
  void tail.then(() => {
    if (queues.get(hq) === tail) queues.delete(hq);
  });
  return next;
}

async function push(hq: string): Promise<void> {
  const branch = (await git(hq, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const [remote, ref] = (
    await git(hq, [
      "for-each-ref",
      "--format=%(upstream:remotename) %(upstream)",
      `refs/heads/${branch}`,
    ])
  )
    .trim()
    .split(" ");
  // The upstream's remote branch is "refs/remotes/<remote>/<name>".
  const name = ref?.replace(/^refs\/remotes\/[^/]+\//, "");
  if (!remote || !name) return;
  await git(hq, ["push", remote, `HEAD:refs/heads/${name}`], {
    timeout: 120_000,
  });
}

// Commits exactly these files (nothing else in the tree) and pushes when the
// stored visibility is private. Never throws: a failure is logged, and the
// next call's push carries the commit along.
export function commitLogs(
  hq: string,
  files: string[],
  message: string,
  visibility: Visibility
): Promise<void> {
  return serialized(hq, async () => {
    const rel = files.map((f) => path.relative(hq, f));
    try {
      const opts = { literalPathspecs: true };
      await git(hq, ["add", "--", ...rel], opts);
      await git(hq, ["commit", "-m", message, "--only", "--", ...rel], opts);
    } catch (error) {
      console.error(`[session-logs] commit in ${hq}:`, error);
      return;
    }
    if (visibility !== "private") return;
    try {
      await push(hq);
    } catch (error) {
      console.error(`[session-logs] push from ${hq} failed (kept):`, error);
    }
  });
}
