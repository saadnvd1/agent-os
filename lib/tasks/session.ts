import fs from "fs";
import os from "os";
import { db, queries, type Session } from "../db";
import { isBranchName } from "../git";
import { getProject } from "../projects";
import { findPR, findPRStrict, run } from "./gh";
import type { TaskPR } from "./state";

export const expandHome = (p: string) => p.replace(/^~/, os.homedir());

export function taskSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM sessions WHERE task_status IS NOT NULL ORDER BY created_at DESC`
    )
    .all() as Session[];
}

export function getTaskSession(id: string): Session {
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session?.task_status) throw new Error("Task not found");
  return session;
}

export function projectPathFor(session: Session): string | null {
  if (!session.project_id) return null;
  const project = getProject(session.project_id);
  return project ? expandHome(project.working_directory) : null;
}

// The branch the task's worktree is on; null when the worktree is gone, on
// another host, or not on a branch (mid-rebase).
async function worktreeBranch(session: Session): Promise<string | null> {
  if (!session.worktree_path) return null;
  if (session.host_id && session.host_id !== "local") return null;
  const dir = expandHome(session.worktree_path);
  if (!fs.existsSync(dir)) return null;
  try {
    const out = await run("git", ["branch", "--show-current"], dir, 5000);
    return out.trim() || null;
  } catch {
    return null;
  }
}

const hasBranch = (dir: string, branch: string) =>
  run(
    "git",
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    dir,
    5000
  ).then(
    () => true,
    () => false
  );

// A branch renamed under a task (from the UI, or by its agent) moves the row
// with it, so its PR is still found. Only a rename: the old branch is gone,
// and the new one is a plain name that isn't the base or another session's.
// A checkout of some other branch leaves the row alone. True when it moved;
// `session` is updated in place.
export async function syncBranch(session: Session): Promise<boolean> {
  const current = await worktreeBranch(session);
  const old = session.branch_name;
  if (!current || current === old || !isBranchName(current)) return false;
  if (current === session.base_branch) return false;
  const dir = expandHome(session.worktree_path!);
  if (old && (await hasBranch(dir, old))) return false;
  const owned = db
    .prepare(`SELECT 1 FROM sessions WHERE branch_name = ? AND id != ?`)
    .get(current, session.id);
  if (owned) return false;
  const { changes } = db
    .prepare(
      `UPDATE sessions SET branch_name = ? WHERE id = ? AND branch_name IS ?`
    )
    .run(current, session.id, old);
  if (!changes) return false;
  console.log(
    `[tasks] ${session.id.slice(0, 8)}: branch ${old ?? "(none)"} -> ${current}, renamed in its worktree`
  );
  session.branch_name = current;
  return true;
}

// sqlite's "2026-10-07 11:00:00" (UTC) as ISO.
const isoUTC = (t: string) => (/[TZ]/.test(t) ? t : `${t.replace(" ", "T")}Z`);

const prCache = new Map<string, { at: number; pr: TaskPR | null }>();

// strict: a gh failure throws instead of reading as "no PR".
export async function prFor(
  session: Session,
  fresh = false,
  strict = false
): Promise<TaskPR | null> {
  const repo = projectPathFor(session);
  if (!repo) return null;
  const cached = prCache.get(session.id);
  if (!fresh && cached && Date.now() - cached.at < 20000) return cached.pr;
  const moved = await syncBranch(session);
  if (!session.branch_name) return null;
  let pr = await (strict ? findPRStrict : findPR)(repo, session.branch_name, {
    openOnly: moved,
    // Until the task has a PR, one older than the task isn't it.
    since: session.pr_number ? undefined : isoUTC(session.created_at),
  });
  // Once the task has a PR, its branch never hands it a different one.
  if (pr && session.pr_number && pr.number !== session.pr_number) {
    const msg = `${session.branch_name} now resolves to PR #${pr.number}, not the task's #${session.pr_number}`;
    if (strict) throw new Error(msg);
    console.warn(`[tasks] ${session.id.slice(0, 8)}: ${msg}`);
    pr = null;
  }
  prCache.set(session.id, { at: Date.now(), pr });
  if (pr) {
    db.prepare(
      `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ? WHERE id = ?`
    ).run(pr.url, pr.number, pr.state.toLowerCase(), session.id);
  }
  return pr;
}

export function forgetPR(sessionId: string): void {
  prCache.delete(sessionId);
}
