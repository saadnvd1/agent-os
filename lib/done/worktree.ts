/**
 * What happens to a session's worktree when its work ends: removed only
 * when nothing in it would be lost, kept otherwise with the reason. Done
 * and a sign-off's cleanup both go through here.
 */

import fs from "fs";
import type { Session } from "../db";
import { getDefaultBranch } from "../git";
import { run } from "../tasks/gh";
import {
  deleteWorktree,
  isAgentOSWorktree,
  removalRunning,
  removalSettled,
} from "../worktrees";
import { describeChanges, unsavedChanges } from "../worktree-placed";

export type WorktreeFate =
  | { action: "none" }
  | { action: "removed"; why: string }
  | { action: "kept"; why: string; path: string };

const git = (cwd: string, ...args: string[]) =>
  run("git", args, cwd, 30000).then((out) => out.trim());

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

// Decides without touching anything, after any removal already running
// (a sign-off's cleanup, just before a done) has finished: a tree read
// while git deletes it lists every deleted file as a change.
export async function worktreeFate(
  session: Pick<Session, "worktree_path" | "base_branch">,
  merged: MergedAs | null
): Promise<FatePreview> {
  const path = session.worktree_path;
  for (;;) {
    if (path) await removalSettled(path);
    const fate = await judge(session, merged);
    if (!path || !removalRunning(path)) return fate;
  }
}

// Uncommitted work always keeps it; a merged branch goes only if every
// commit on it was in the merge or is on a remote; an unmerged one only if
// it has no commits of its own.
async function judge(
  session: Pick<Session, "worktree_path" | "base_branch">,
  merged: MergedAs | null
): Promise<FatePreview> {
  const path = session.worktree_path;
  if (!path || !fs.existsSync(path)) return { action: "none" };
  const keep = (why: string) => ({ action: "kept" as const, why, path });
  if (!isAgentOSWorktree(path)) return keep("it isn't an AgentOS worktree");
  const repo = await repoOf(path).catch(() => null);
  if (!repo) return keep("it isn't a git worktree any more");
  // What AgentOS placed itself (env copies, cloned dependencies) and
  // nobody has touched since isn't work; anything else is.
  const unsaved = await unsavedChanges(path).catch(() => null);
  if (!unsaved) return keep("its uncommitted changes can't be checked");
  if (unsaved.length)
    return keep(`it has uncommitted changes (${describeChanges(unsaved)})`);
  if (merged) {
    const stray = await strayCommits(path, merged).catch(() => null);
    if (stray === null) return keep("its commits can't be checked");
    if (stray > 0)
      return keep(
        `${stray} commit${stray === 1 ? " is" : "s are"} on it that the merged PR didn't include and no remote has`
      );
    return { action: "remove", why: "its branch is merged", repo };
  }
  const base = session.base_branch || (await getDefaultBranch(repo));
  const own = await ownCommits(path, base).catch(() => null);
  if (own === null) return keep(`its base ${base} can't be found to compare`);
  if (own > 0)
    return keep(
      `its branch has ${own} commit${own === 1 ? "" : "s"} not merged into ${base}`
    );
  return {
    action: "remove",
    why: "its branch has no commits of its own",
    repo,
  };
}

// Removes the worktree (and its local branch) when nothing would be lost,
// and says so only once it's really gone.
export async function settleWorktree(
  session: Pick<Session, "worktree_path" | "base_branch">,
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
