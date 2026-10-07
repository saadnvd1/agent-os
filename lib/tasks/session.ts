import fs from "fs";
import os from "os";
import { db, queries, type Session } from "../db";
import { isBranchName } from "../git";
import { getProject } from "../projects";
import { findPRStrict, run } from "./gh";
import { lookupPR } from "./pr-poll";
import type { TaskPR } from "./state";

export const expandHome = (p: string) => p.replace(/^~/, os.homedir());

export function taskSessions(): Session[] {
  return db
    .prepare(
      `SELECT * FROM sessions WHERE task_status IS NOT NULL AND task_status != 'moved' ORDER BY created_at DESC`
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

// The task's worktree, when it's here to look at: null when it's gone or on
// another host.
function localWorktree(session: Session): string | null {
  if (!session.worktree_path) return null;
  if (session.host_id && session.host_id !== "local") return null;
  const dir = expandHome(session.worktree_path);
  return fs.existsSync(dir) ? dir : null;
}

// The branch it's on; null when not on a branch (mid-rebase).
async function worktreeBranch(session: Session): Promise<string | null> {
  const dir = localWorktree(session);
  if (!dir) return null;
  try {
    const out = await run("git", ["branch", "--show-current"], dir, 5000);
    return out.trim() || null;
  } catch {
    return null;
  }
}

const hasRef = (dir: string, ref: string) =>
  run("git", ["rev-parse", "--verify", "--quiet", ref], dir, 5000).then(
    () => true,
    // Exit 1 is "no such branch"; a timeout or a lock isn't an answer.
    (e: { code?: unknown }) => e?.code !== 1
  );

// A branch renamed under a task (from the UI, or by its agent): the row
// follows it, so its PR is still found. Only a rename: the old branch is
// gone, and the new one is a plain name that isn't the base or another
// session's. A checkout of some other branch is not followed.
async function renamedBranch(session: Session): Promise<string | null> {
  const current = await worktreeBranch(session);
  const old = session.branch_name;
  if (!current || current === old || !isBranchName(current)) return null;
  if (current === session.base_branch) return null;
  if (
    old &&
    (await hasRef(expandHome(session.worktree_path!), `refs/heads/${old}`))
  )
    return null;
  const owned = db
    .prepare(`SELECT 1 FROM sessions WHERE branch_name = ? AND id != ?`)
    .get(current, session.id);
  return owned ? null : current;
}

// `session` is updated in place.
function moveBranch(session: Session, branch: string): void {
  const old = session.branch_name;
  const { changes } = db
    .prepare(
      `UPDATE sessions SET branch_name = ? WHERE id = ? AND branch_name IS ?`
    )
    .run(branch, session.id, old);
  if (!changes) return;
  console.log(
    `[tasks] ${session.id.slice(0, 8)}: branch ${old ?? "(none)"} -> ${branch}, renamed in its worktree`
  );
  session.branch_name = branch;
}

// git merge-base --is-ancestor: exit 0 yes, 1 no, anything else can't say.
const isAncestor = (dir: string, sha: string, ref: string) =>
  run("git", ["merge-base", "--is-ancestor", sha, ref], dir, 5000).then(
    () => true as const,
    (e: { code?: unknown }) => (e?.code === 1 ? (false as const) : null)
  );

// Whether the PR's head is the task's own work: on its branch and not
// already on the base (someone else's PR the task rebased onto). null when
// git can't say. A worktree that's gone can't either, and the task's PR was
// linked by then.
async function ownWork(
  session: Session,
  branch: string,
  sha?: string
): Promise<boolean | null> {
  const dir = localWorktree(session);
  if (!dir) return true;
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return false;
  const mine = await isAncestor(dir, sha, `refs/heads/${branch}`);
  if (mine !== true || !session.base_branch) return mine;
  const base = `refs/remotes/origin/${session.base_branch}`;
  if (!(await hasRef(dir, base))) return true;
  const onBase = await isAncestor(dir, sha, base);
  return onBase === null ? null : !onBase;
}

// sqlite's "2026-10-07 11:00:00" (UTC) as ISO.
export const isoUTC = (t: string) =>
  /[TZ]/.test(t) ? t : `${t.replace(" ", "T")}Z`;

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
  const renamed = await renamedBranch(session);
  const branch = renamed ?? session.branch_name;
  if (!branch) return null;
  // A PR older than the task is an earlier use of the branch's name.
  const since = isoUTC(session.created_at);
  let pr: TaskPR | null;
  if (renamed) {
    // Follow a rename only on gh's answer: a failure leaves the row put.
    try {
      pr = await findPRStrict(repo, branch, { since });
    } catch (error) {
      if (strict) throw error;
      return null;
    }
  } else pr = await lookupPR(repo, branch, { fresh, strict, since });
  // A PR becomes the task's only if its head is the task's work; a rename
  // onto a branch with someone else's PR is not followed.
  let refused = false;
  if (pr && pr.number !== session.pr_number) {
    const own = await ownWork(session, branch, pr.head);
    if (own !== true) {
      const msg = `PR #${pr.number} on ${branch} ${own === false ? "isn't the task's work" : "can't be checked against its worktree"}; not linked`;
      if (strict) throw new Error(msg);
      console.warn(`[tasks] ${session.id.slice(0, 8)}: ${msg}`);
      pr = null;
      refused = true;
    }
  }
  if (renamed && !refused) moveBranch(session, renamed);
  prCache.set(session.id, { at: Date.now(), pr });
  if (pr) {
    db.prepare(
      `UPDATE sessions SET pr_url = ?, pr_number = ?, pr_status = ? WHERE id = ?`
    ).run(pr.url, pr.number, pr.state.toLowerCase(), session.id);
  }
  return pr;
}

// A finished task's PR as the database last saw it: no gh call.
export function storedPR(s: Session): TaskPR | null {
  if (!s.pr_number) return null;
  return {
    number: s.pr_number,
    url: s.pr_url ?? "",
    state:
      s.task_status === "merged" || s.pr_status === "merged"
        ? "MERGED"
        : s.pr_status === "open"
          ? "OPEN"
          : "CLOSED",
    checks: "none",
  };
}

export function forgetPR(sessionId: string): void {
  prCache.delete(sessionId);
}
