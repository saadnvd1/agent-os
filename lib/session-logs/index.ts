/**
 * Session logs: when a task merges, AgentOS writes a log of it from data it
 * already holds. It costs no model tokens, on purpose: nothing in this
 * folder may call a model (a test holds it to that).
 *
 * captureMergedTask is called from every place a task becomes merged
 * (sign-off, done, a merge seen on GitHub). It reads the plan file at once,
 * because cleanup removes the worktree, then does the rest in the
 * background. It runs once per task and never throws into the merge.
 */

import os from "os";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { run } from "../tasks/gh";
import { buildLogMarkdown, sqliteMs } from "./build";
import { writeLogFile } from "./folder";
import { gatherLogData, readPlanFile } from "./gather";
import { hasLog, insertLog, setFilePath } from "./store";

export * from "./store";
export { buildLogMarkdown } from "./build";
export { logFolder, setLogFolder } from "./folder";

const inFlight = new Map<string, Promise<void>>();
// Tasks known to have a log, so a poll that sees a merged PR again asks
// nothing of the database.
const done = new Set<string>();

const sqliteNow = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export interface CaptureOpts {
  // The PR's head at the merge, when the caller knows it.
  head?: string | null;
  // The plan, when it was read already; else the worktree is read now.
  plan?: string | null;
  // A log written after the worktree went (the backfill).
  planKept?: boolean;
  // Skip asking GitHub for the merge commit (a batch of old tasks).
  noGh?: boolean;
}

function eligible(s: Session | undefined): s is Session {
  return (
    !!s &&
    !!s.task_prompt &&
    !s.peer_mirror &&
    s.task_status !== "dropped" &&
    (s.task_status === "merged" || s.pr_status === "merged")
  );
}

async function mergeCommitOf(s: Session): Promise<string | null> {
  const project = s.project_id ? getProject(s.project_id) : undefined;
  if (!project || !s.pr_number || process.env.AGENTOS_SESSION_LOGS_NO_GH)
    return null;
  try {
    const out = await run(
      "gh",
      [
        "pr",
        "view",
        String(s.pr_number),
        "--json",
        "mergeCommit",
        "-q",
        ".mergeCommit.oid",
      ],
      project.working_directory.replace(/^~/, os.homedir()),
      15_000
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function writeLog(
  id: string,
  opts: CaptureOpts & { plan?: string | null } = {}
): Promise<boolean> {
  const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;
  if (!eligible(row) || hasLog(id)) return false;
  const s = { ...row, merged_at: row.merged_at ?? sqliteNow() };
  const mergeCommit = opts.noGh ? null : await mergeCommitOf(s);
  const data = gatherLogData(s, {
    plan: opts.plan ?? null,
    planKept: opts.planKept ?? true,
    head: opts.head ?? null,
    mergeCommit: mergeCommit ?? (opts.head ? `${opts.head} (PR head)` : null),
  });
  const markdown = buildLogMarkdown(data);
  const start = sqliteMs(data.startedAt);
  const end = sqliteMs(data.mergedAt);
  const stored = insertLog({
    sessionId: id,
    projectId: s.project_id,
    workspaceId:
      s.workspace_id ?? getProject(s.project_id ?? "")?.workspace_id ?? null,
    markdown,
    header: {
      id,
      name: data.name,
      workspace: data.workspace,
      project: data.project,
      branch: data.branch,
      prNumber: data.prNumber,
      prUrl: data.prUrl,
      mergeCommit: data.mergeCommit,
      startedAt: data.startedAt,
      mergedAt: data.mergedAt,
      durationMs: start !== null && end !== null ? end - start : null,
      costUsd: data.usage.reduce((t, u) => t + u.costUsd, 0),
      planKept: data.planKept,
      hasPlan: data.plan !== null,
    },
    filePath: null,
  });
  if (!stored) return false;
  try {
    const file = writeLogFile(
      {
        workspace: data.workspace,
        project: data.project,
        projectId: s.project_id,
        name: data.name,
        id,
        day: (data.mergedAt ?? sqliteNow()).slice(0, 10),
      },
      markdown
    );
    setFilePath(id, file);
  } catch (error) {
    // The database holds the log; the file is a copy.
    console.error(`[session-logs] file for ${id}:`, error);
  }
  return true;
}

export function captureMergedTask(
  id: string,
  opts: CaptureOpts = {}
): Promise<void> {
  if (done.has(id)) return Promise.resolve();
  const running = inFlight.get(id);
  if (running) return running;
  let plan: string | null | undefined = opts.plan;
  try {
    if (plan === undefined) {
      const row = db
        .prepare(`SELECT worktree_path FROM sessions WHERE id = ?`)
        .get(id) as { worktree_path: string | null } | undefined;
      plan = readPlanFile(row?.worktree_path ?? null);
    }
  } catch (error) {
    console.error(`[session-logs] plan for ${id}:`, error);
  }
  const job = (async () => {
    // After the caller's own work: the merge never waits on this.
    await new Promise<void>((r) => setImmediate(r));
    try {
      await writeLog(id, { ...opts, plan });
      if (hasLog(id)) done.add(id);
    } catch (error) {
      console.error(`[session-logs] ${id}:`, error);
    }
  })().finally(() => inFlight.delete(id));
  inFlight.set(id, job);
  return job;
}

// Tests start from nothing.
export function resetSessionLogState(): void {
  done.clear();
  inFlight.clear();
}
