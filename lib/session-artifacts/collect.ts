/**
 * A session's artifacts, read cheaply: one indexed query over its chat items
 * (never a tool's output or a Write's content), a stat per file, one git
 * status while its worktree is there, and its PR, recipe run and log rows.
 * Cached until the chat moves on, and for a minute at most.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db, queries, type Session } from "../db";
import { flushItems } from "../chat/store";
import { git } from "../git-exec";
import { PLAN_FILE } from "../models/plan-step";
import { listArtifacts } from "../artifacts/store";
import { allowedRoots, within } from "./access";
import { SCREENSHOT_DIR } from "../tasks/ui-brief";
import {
  fromItems,
  fromPr,
  fromRun,
  fromSessionLog,
  fromStatus,
  mergePlan,
  parsePorcelain,
  sortEntries,
  stateOf,
  toArtifact,
  type Candidate,
  type Entry,
  type FileFacts,
  type ItemRow,
  type RunRow,
} from "./derive";
import { keepFiles, readManifest, relInside, sessionKeptDir } from "./keep";

export const MAX_FILES = 500;
const CACHE_MS = 60_000;
const CACHE_SIZE = 50;
const STATUS_TIMEOUT_MS = 3000;

const ITEMS_SQL = `
  SELECT item_id, kind,
         json_extract(data, '$.createdAt') AS at,
         json_extract(data, '$.name') AS name,
         json_extract(data, '$.status') AS status,
         json_extract(data, '$.input.file_path') AS file_path,
         json_extract(data, '$.input.notebook_path') AS notebook_path,
         json_extract(data, '$.input.path') AS input_path,
         json_extract(data, '$.input.filePath') AS file_path_camel,
         json_extract(data, '$.input.changes') AS changes,
         json_extract(data, '$.artifactId') AS artifact_id,
         json_extract(data, '$.title') AS title,
         json_extract(data, '$.taskId') AS task_id,
         json_extract(data, '$.outputFile') AS output_file,
         json_extract(data, '$.taskType') AS task_type,
         json_extract(data, '$.subagentType') AS subagent_type,
         json_extract(data, '$.description') AS description,
         json_extract(data, '$.ambient') AS ambient,
         json_array_length(data, '$.images') AS image_count
    FROM chat_items
   WHERE session_id = ? AND kind IN ('tool', 'artifact', 'task', 'plan', 'user')
   ORDER BY seq`;

const expand = (p: string) =>
  p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p;

const sqliteMs = (t: string | null | undefined) =>
  t ? Date.parse(t.includes("T") ? t : `${t.replace(" ", "T")}Z`) || 0 : 0;

export function getSession(id: string): Session | undefined {
  return queries.getSession(db).get(id) as Session | undefined;
}

function projectPath(session: Session): string | null {
  if (!session.project_id) return null;
  const row = db
    .prepare(`SELECT working_directory FROM projects WHERE id = ?`)
    .get(session.project_id) as { working_directory: string } | undefined;
  return row ? expand(row.working_directory) : null;
}

export function rootsOf(session: Session): string[] {
  return allowedRoots({
    worktree_path: session.worktree_path,
    working_directory: session.working_directory,
    projectPath: projectPath(session),
  });
}

function runs(sessionId: string): RunRow[] {
  return (
    db
      .prepare(
        `SELECT r.id, r.status, x.name AS recipe_name,
                COALESCE(r.ended_at, r.started_at, r.created_at) AS t
           FROM recipe_runs r LEFT JOIN recipes x ON x.id = r.recipe_id
          WHERE r.session_id = ? ORDER BY r.id`
      )
      .all(sessionId) as (RunRow & { t: string })[]
  ).map((r) => ({ ...r, at: sqliteMs(r.t) }));
}

function logAt(sessionId: string): number | null {
  const row = db
    .prepare(`SELECT created_at FROM session_logs WHERE session_id = ?`)
    .get(sessionId) as { created_at: string } | undefined;
  return row ? sqliteMs(row.created_at) : null;
}

const filePathOf = (c: Candidate): string | undefined =>
  c.source.type === "file"
    ? c.source.path
    : c.source.type === "plan" || c.source.type === "log"
      ? c.source.path
      : undefined;

async function sizeOf(file: string): Promise<number | undefined> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    return undefined;
  }
}

function realWithin(file: string, roots: string[]): boolean {
  if (!within(file, roots)) return false;
  try {
    return within(fs.realpathSync(file), roots);
  } catch {
    return true;
  }
}

async function build(session: Session): Promise<Entry[]> {
  flushItems();
  const rows = db.prepare(ITEMS_SQL).all(session.id) as ItemRow[];
  const cwd = session.working_directory
    ? expand(session.working_directory)
    : null;
  let candidates = fromItems(rows, cwd);

  const isLocal = !session.host_id || session.host_id === "local";
  const worktree =
    isLocal && session.worktree_path ? expand(session.worktree_path) : null;
  const worktreeThere = !!worktree && fs.existsSync(worktree);
  const latest = rows.reduce((m, r) => Math.max(m, r.at ?? 0), 0);

  if (worktreeThere) {
    const out = await git(
      worktree,
      ["status", "--porcelain", "-z", "--untracked-files=all"],
      { timeout: STATUS_TIMEOUT_MS }
    ).catch(() => "");
    const known = new Set(candidates.map((c) => c.key));
    candidates.push(
      ...fromStatus(parsePorcelain(out), worktree, latest, known)
    );
  }

  const manifest = worktree && !worktreeThere ? readManifest(session.id) : null;
  if (worktree) {
    const planFile = path.join(worktree, PLAN_FILE);
    const named = candidates.some((c) => c.key === `file:${planFile}`);
    const there = worktreeThere
      ? fs.existsSync(planFile)
      : !!manifest?.kept.includes(PLAN_FILE);
    if (named || there) candidates = mergePlan(candidates, planFile);
  }

  const pr = fromPr({
    pr_url: session.pr_url,
    pr_number: session.pr_number,
    pr_status: session.pr_status,
    at: sqliteMs(session.merged_at ?? session.updated_at),
  });
  if (pr) candidates.push(pr);
  candidates.push(...runs(session.id).map(fromRun));
  const log = logAt(session.id);
  if (log !== null) candidates.push(fromSessionLog(log));

  // The newest files first, so the cap drops the oldest.
  const fileBacked = candidates
    .filter((c) => filePathOf(c))
    .sort((a, b) => b.at - a.at);
  const dropped = new Set(fileBacked.slice(MAX_FILES).map((c) => c.key));
  candidates = candidates.filter((c) => !dropped.has(c.key));

  const roots = rootsOf(session);
  const keptBase = sessionKeptDir(session.id);
  const tracked = new Set(manifest?.tracked);
  const kept = new Set(manifest?.kept);
  const pages = new Map(listArtifacts(session.id).map((a) => [a.id, a.path]));
  const entries = await Promise.all(
    candidates.map(async (c): Promise<Entry> => {
      if (c.source.type === "page") {
        const page = pages.get(c.source.artifactId);
        const size = page ? await sizeOf(page) : undefined;
        return toArtifact(
          c,
          size === undefined ? { state: "gone" } : { state: "live", size }
        );
      }
      const file = filePathOf(c);
      if (!file) return toArtifact(c, null);
      const facts: FileFacts = {
        size: await sizeOf(file),
        allowed: realWithin(file, roots),
      };
      const rel = worktree ? relInside(worktree, file) : null;
      let read: string | undefined =
        facts.size !== undefined ? file : undefined;
      if (facts.size === undefined && rel && manifest) {
        if (kept.has(rel)) {
          const copy = path.join(keptBase, rel);
          facts.keptSize = await sizeOf(copy);
          if (facts.keptSize !== undefined) read = copy;
        }
        facts.committed = tracked.has(rel) && !!session.pr_number;
      }
      const state = stateOf(facts);
      // A plan proposed in chat still opens when its file has gone.
      if (
        c.source.type === "plan" &&
        c.source.chatItemId &&
        (state.state === "gone" || state.state === "in-pr")
      )
        return toArtifact(c, { state: "live", path: file });
      // A running job's output file is named only once it ends.
      if (c.source.type === "log" && !c.source.path)
        return toArtifact(c, { state: "live" });
      return toArtifact(c, {
        ...state,
        path: file,
        read: state.state === "outside" ? undefined : read,
      });
    })
  );
  if (worktree)
    for (const { artifact: a } of entries) {
      const rel = a.path && relInside(worktree, untilde(a.path));
      if (rel) a.folder = path.posix.dirname(rel).replace(/^\.$/, "");
    }
  return sortEntries(entries);
}

const untilde = (p: string) =>
  p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;

interface Cached {
  sig: string;
  at: number;
  entries: Promise<Entry[]>;
}
const cache = new Map<string, Cached>();

function signature(session: Session): string {
  const row = db
    .prepare(`SELECT max(seq) AS seq FROM chat_items WHERE session_id = ?`)
    .get(session.id) as { seq: number | null };
  return [
    row.seq ?? 0,
    session.pr_status,
    session.pr_number,
    session.worktree_path,
    session.updated_at,
  ].join("|");
}

export function forgetArtifacts(sessionId: string): void {
  cache.delete(sessionId);
}

export async function collectArtifacts(
  session: Session,
  now = Date.now()
): Promise<Entry[]> {
  flushItems();
  const sig = signature(session);
  const hit = cache.get(session.id);
  if (hit && hit.sig === sig && now - hit.at < CACHE_MS) {
    // Recently used stays.
    cache.delete(session.id);
    cache.set(session.id, hit);
    return hit.entries;
  }
  const entries = build(session);
  cache.set(session.id, { sig, at: now, entries });
  entries.catch(() => cache.delete(session.id));
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return entries;
}

export const cachedCount = () => cache.size;

// What the UI brief has a terminal session save, whether or not a chat tool
// call named it: the PR names these files and the worktree is about to go.
export function screenshotsIn(worktree: string): string[] {
  const dir = path.join(worktree, SCREENSHOT_DIR);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Before a session's worktree is removed: copy what it made there that git
 * doesn't hold. Never throws, and never holds up the removal for long.
 */
export async function keepSessionFiles(sessionId: string): Promise<void> {
  try {
    const session = getSession(sessionId);
    if (!session?.worktree_path) return;
    if (session.host_id && session.host_id !== "local") return;
    const worktree = expand(session.worktree_path);
    if (!fs.existsSync(worktree)) return;
    forgetArtifacts(sessionId);
    const entries = await collectArtifacts(session);
    const files = entries
      .map((e) => e.read)
      .filter((f): f is string => !!f && !!relInside(worktree, f));
    await keepFiles(sessionId, worktree, [
      ...new Set([...files, ...screenshotsIn(worktree)]),
    ]);
  } catch (error) {
    console.error(`[session-artifacts] keeping ${sessionId}:`, error);
  } finally {
    forgetArtifacts(sessionId);
  }
}
