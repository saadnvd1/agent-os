// Open asks about work that finished some other way: their task was
// merged, dropped or done, or the PR they link was merged or closed (by a
// sign-off, another session, or on GitHub). Each is closed with what
// happened, so Saad's list never asks him about work that's already done.

import os from "os";
import { db } from "../db";
import { run } from "../tasks/gh";
import { openAsks, resolveAsks, type AskRow } from "./asks";
import { addNote } from "./notes";

const PR_LINK =
  /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/i;

// owner/repo#n, however the link is written.
export function prKey(link: string | null): string | null {
  const m = link?.trim().match(PR_LINK);
  return m ? `${m[1].toLowerCase()}#${m[2]}` : null;
}

export interface PRState {
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeSha: string | null;
}

// What GitHub last said about each PR an ask links. Merged is final; an
// open or closed one (it can be reopened) is looked up again after a minute.
const seen = new Map<string, { at: number; pr: PRState }>();
const RECHECK_MS = 60 * 1000;

interface TaskRow {
  id: string;
  task_status: "running" | "merged" | "dropped" | "done";
  pr_status: "open" | "merged" | "closed" | null;
  pr_url: string | null;
  pr_number: number | null;
}

// Every task of the workspace, archived ones too: a merged task is usually
// archived by the time its stale ask is noticed.
function workspaceTasks(workspaceId: string): TaskRow[] {
  return db
    .prepare(
      `SELECT s.id, s.task_status, s.pr_status, s.pr_url, s.pr_number
       FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE p.workspace_id = ? AND s.task_status IS NOT NULL`
    )
    .all(workspaceId) as TaskRow[];
}

const taskIdOf = (ask: AskRow) =>
  ask.subject.startsWith("task:") ? ask.subject.slice(5) : null;

interface Index {
  byId: Map<string, TaskRow>;
  byPR: Map<string, TaskRow>;
}

function index(workspaceId: string): Index {
  const tasks = workspaceTasks(workspaceId);
  const byPR = new Map<string, TaskRow>();
  for (const t of tasks) {
    const key = prKey(t.pr_url);
    if (key) byPR.set(key, t);
  }
  return { byId: new Map(tasks.map((t) => [t.id, t])), byPR };
}

function taskFor(ask: AskRow, { byId, byPR }: Index): TaskRow | undefined {
  const id = taskIdOf(ask);
  if (id) return byId.get(id);
  const key = prKey(ask.link);
  return key ? byPR.get(key) : undefined;
}

const short = (sha: string) => sha.slice(0, 7);

// Why the ask no longer needs Saad, or null while it still does.
export function staleReason(ask: AskRow, idx: Index): string | null {
  const task = taskFor(ask, idx);
  if (taskIdOf(ask) && !task) return "the task is gone";
  const key = prKey(ask.link) ?? prKey(task?.pr_url ?? null);
  const gh = key ? seen.get(key)?.pr : undefined;
  // A task whose PR is open again outranks GitHub's older "closed".
  const reopened = task?.task_status === "running" && task.pr_status === "open";
  const what = key ? `PR #${key.split("#")[1]}` : "the task";
  if (
    task?.task_status === "merged" ||
    task?.pr_status === "merged" ||
    gh?.state === "MERGED"
  )
    return gh?.mergeSha
      ? `${what} merged as ${short(gh.mergeSha)} elsewhere`
      : `${what} merged elsewhere`;
  if (task?.task_status === "dropped") return "the task was dropped";
  if (task?.pr_status === "closed" || (gh?.state === "CLOSED" && !reopened))
    return `${what} was closed without merging`;
  if (task?.task_status === "done") return "the task was done";
  return null;
}

function settle(
  workspaceId: string,
  asks: AskRow[],
  why: (a: AskRow) => string | null
): number {
  let n = 0;
  for (const ask of asks) {
    const reason = why(ask);
    if (!reason || !resolveAsks(workspaceId, ask.subject, reason)) continue;
    addNote(workspaceId, `Closed ask "${ask.title}": ${reason}.`, "ask");
    n++;
  }
  return n;
}

// Closing stale asks is bookkeeping: an error is logged, never thrown into
// the read or the merge that asked for it.
function quietly(where: string, close: () => number): number {
  try {
    return close();
  } catch (error) {
    console.error(`[orchestrator] closing stale asks for ${where}:`, error);
    return 0;
  }
}

// Only the asks about a task or a PR; brake and passkey asks settle
// their own way, whatever they link.
const aboutWork = (ask: AskRow) =>
  ask.kind !== "brake" &&
  ask.kind !== "passkey" &&
  (!!taskIdOf(ask) || !!prKey(ask.link));

// From what's already known locally (and GitHub's last answers): cheap
// enough for every read of the asks.
export function resolveStaleAsks(workspaceId: string): number {
  return quietly(workspaceId, () => {
    const asks = openAsks(workspaceId).filter(aboutWork);
    if (!asks.length) return 0;
    const idx = index(workspaceId);
    return settle(workspaceId, asks, (a) => staleReason(a, idx));
  });
}

async function viewPR(key: string): Promise<PRState> {
  const [repo, number] = key.split("#");
  const out = await run(
    "gh",
    ["pr", "view", number, "--repo", repo, "--json", "state,mergeCommit"],
    os.tmpdir(),
    15000
  );
  return parsePRView(out);
}

// `gh pr view --json state,mergeCommit`; anything else throws, so the ask
// stays open.
export function parsePRView(json: string): PRState {
  const pr = JSON.parse(json) as {
    state?: unknown;
    mergeCommit?: { oid?: unknown } | null;
  };
  if (pr.state !== "OPEN" && pr.state !== "MERGED" && pr.state !== "CLOSED")
    throw new Error(`gh pr view: unknown state ${String(pr.state)}`);
  const oid = pr.mergeCommit?.oid;
  return {
    state: pr.state,
    mergeSha:
      typeof oid === "string" && /^[0-9a-f]{7,40}$/.test(oid) ? oid : null,
  };
}

// Asks GitHub about the PRs open asks link that no running task already
// tracks (those are refreshed with the task), and about finished ones once
// for their merge commit. A failed lookup leaves the ask open.
export async function refreshAskPRs(
  workspaceId: string,
  view: (key: string) => Promise<PRState> = viewPR,
  now = Date.now()
): Promise<void> {
  const asks = openAsks(workspaceId).filter(aboutWork);
  if (!asks.length) return;
  const idx = index(workspaceId);
  const keys = new Set<string>();
  for (const ask of asks) {
    const task = taskFor(ask, idx);
    const key = prKey(ask.link) ?? prKey(task?.pr_url ?? null);
    if (!key) continue;
    const last = seen.get(key);
    if (last && (last.pr.state === "MERGED" || now - last.at < RECHECK_MS))
      continue;
    if (task?.task_status === "running" && task.pr_status === "open") continue;
    keys.add(key);
  }
  await Promise.all(
    [...keys].map(async (key) => {
      try {
        seen.set(key, { at: now, pr: await view(key) });
      } catch {
        // gh couldn't say; asked again on the next pass.
      }
    })
  );
}

// The watcher's pass: GitHub first, then close what's finished.
export async function settleStaleAsks(
  workspaceId: string,
  view?: (key: string) => Promise<PRState>
): Promise<number> {
  await refreshAskPRs(workspaceId, view);
  return resolveStaleAsks(workspaceId);
}

// A task just merged through sign-off: its open asks, and any ask linking
// its PR, close now rather than on the watcher's next pass.
export function resolveMergedTaskAsks(
  taskId: string,
  prUrl: string | null,
  why: string
): number {
  return quietly(`task ${taskId}`, () => {
    const row = db
      .prepare(
        `SELECT p.workspace_id FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`
      )
      .get(taskId) as { workspace_id: string | null } | undefined;
    const workspaceId = row?.workspace_id;
    if (!workspaceId) return 0;
    const key = prKey(prUrl);
    return settle(workspaceId, openAsks(workspaceId).filter(aboutWork), (a) =>
      taskIdOf(a) === taskId || (key && prKey(a.link) === key) ? why : null
    );
  });
}

export function forgetPRStates(): void {
  seen.clear();
}
