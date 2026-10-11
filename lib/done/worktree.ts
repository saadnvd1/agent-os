/**
 * What happens to a session's worktree when its work ends: removed only
 * when nothing in it would be lost, kept otherwise with the reason. Done
 * and a sign-off's cleanup both go through here.
 */

import fs from "fs";
import type { Session } from "../db";
import { getDefaultBranch } from "../git";
import { git as runGit } from "../git-exec";
import { mergePolicy } from "../tasks/merge-policy";
import { getProject } from "../projects";
import { deleteWorktree, isAgentOSWorktree } from "../worktrees";
import { removalRunning, removalSettled } from "../worktree-removal";
import { describeChanges, unsavedChanges } from "../worktree-placed";

export type WorktreeFate =
  | { action: "none" }
  | { action: "removed"; why: string }
  // Removed, or being removed, by something else (a merge's cleanup).
  | { action: "gone"; why: string }
  | { action: "kept"; why: string; path: string };

const git = (cwd: string, ...args: string[]) =>
  runGit(cwd, args, { timeout: 30000 }).then((out) => out.trim());

// The main checkout a worktree belongs to.
async function repoOf(worktree: string): Promise<string> {
  const common = await git(
    worktree,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir"
  );
  return common.replace(/\/\.git\/?$/, "");
}

// Commits on the worktree's HEAD that its base (local or on origin) lacks;
// null when no base ref can be found to compare with.
async function ownCommits(
  worktree: string,
  base: string
): Promise<number | null> {
  const refs: string[] = [];
  for (const ref of [base, `origin/${base}`]) {
    const ok = await git(worktree, "rev-parse", "--verify", "--quiet", ref)
      .then(() => true)
      .catch(() => false);
    if (ok) refs.push(ref);
  }
  if (!refs.length) return null;
  const n = await git(
    worktree,
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    ...refs
  );
  return Number(n) || 0;
}

// What the merge took: the PR's head commit when it's known.
export interface MergedAs {
  prHead?: string | null;
}

// Commits on HEAD that the merged PR's head doesn't contain and no remote
// has: the work a removal would lose. Without a known (local) PR head,
// only the remotes count.
async function strayCommits(
  worktree: string,
  merged: MergedAs
): Promise<number> {
  const head = merged.prHead
    ? await git(
        worktree,
        "rev-parse",
        "--verify",
        "--quiet",
        `${merged.prHead}^{commit}`
      )
        .then(() => [merged.prHead!])
        .catch(() => [])
    : [];
  const n = await git(
    worktree,
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    ...head,
    "--remotes"
  );
  return Number(n) || 0;
}

export type FatePreview =
  | Exclude<WorktreeFate, { action: "removed" }>
  | { action: "remove"; why: string; repo: string };

type Judged = Pick<Session, "worktree_path" | "base_branch"> &
  Partial<Pick<Session, "project_id">>;

// Gone, or still going: removed by whatever else got to it first.
const gone = (merged: MergedAs | null, still = false) => ({
  action: "gone" as const,
  why: `${still ? "still being" : "already"} removed${merged ? " by the merge cleanup" : ""}`,
});

// Decides without touching anything, after any removal already running
// (a merge's cleanup, from any process) has finished: a tree read while
// git deletes it lists every deleted file as a change.
export async function worktreeFate(
  session: Judged,
  merged: MergedAs | null,
  waitMs = 60_000
): Promise<FatePreview> {
  const path = session.worktree_path;
  if (!path) return { action: "none" };
  for (;;) {
    if (!(await removalSettled(path, waitMs))) return gone(merged, true);
    if (!fs.existsSync(path)) return gone(merged);
    const fate = await judge(session, merged);
    // A removal that started while it read: read what it leaves.
    if (!removalRunning(path) && fs.existsSync(path)) return fate;
  }
}

// What the branch's commits would lose: why they keep the worktree, or
// null when every one is merged, pushed or not its own.
async function commitsKeep(
  path: string,
  repo: string,
  session: Judged,
  merged: MergedAs | null
): Promise<string | null> {
  if (merged) {
    const stray = await strayCommits(path, merged).catch(() => null);
    if (stray === null) return "its commits can't be checked";
    if (stray > 0)
      return `${stray} commit${stray === 1 ? " is" : "s are"} on it that the merged PR didn't include and no remote has`;
    return null;
  }
  // A base gone everywhere (a stacked parent's branch, deleted) is judged
  // against the default branch instead.
  const fallback = await getDefaultBranch(repo);
  let base = session.base_branch || fallback;
  let own = await ownCommits(path, base).catch(() => null);
  if (own === null && base !== fallback) {
    base = fallback;
    own = await ownCommits(path, base).catch(() => null);
  }
  if (own === null) return `its base ${base} can't be found to compare`;
  if (own > 0)
    return `its branch has ${own} commit${own === 1 ? "" : "s"} not merged into ${base}`;
  return null;
}

// Uncommitted work always keeps it; a merged branch goes only if the merge
// settings delete worktrees and every commit on it was in the merge or is
// on a remote; an unmerged one only if it has no commits of its own. A
// kept one names every reason, the commits as well as the changes.
async function judge(
  session: Judged,
  merged: MergedAs | null
): Promise<FatePreview> {
  const path = session.worktree_path!;
  const keep = (why: string) => ({ action: "kept" as const, why, path });
  if (!isAgentOSWorktree(path)) return keep("it isn't an AgentOS worktree");
  if (merged && session.project_id) {
    const project = getProject(session.project_id);
    if (project && !mergePolicy(project).delete_worktree)
      return keep("the merge settings keep worktrees after a merge");
  }
  const repo = await repoOf(path).catch(() => null);
  if (!repo) return keep("it isn't a git worktree any more");
  // What AgentOS placed itself (env copies, cloned dependencies) and
  // nobody has touched since isn't work; anything else is.
  const unsaved = await unsavedChanges(path).catch(() => null);
  if (!unsaved) return keep("its uncommitted changes can't be checked");
  const why = [
    unsaved.length
      ? `it has uncommitted changes (${describeChanges(unsaved)})`
      : null,
    await commitsKeep(path, repo, session, merged),
  ].filter((w) => w !== null);
  if (why.length) return keep(why.join(", and "));
  return {
    action: "remove",
    why: merged
      ? "its branch is merged"
      : "its branch has no commits of its own",
    repo,
  };
}

// Removes the worktree (and its local branch) when nothing would be lost,
// and says so only once it's really gone.
export async function settleWorktree(
  session: Judged,
  merged: MergedAs | null
): Promise<WorktreeFate> {
  const fate = await worktreeFate(session, merged);
  if (fate.action !== "remove") return fate;
  const path = session.worktree_path!;
  await deleteWorktree(path, fate.repo, true).catch(() => {});
  if (fs.existsSync(path))
    return { action: "kept", why: "removing it failed", path };
  return { action: "removed", why: fate.why };
}
