/**
 * What done does with a session's worktree: removed only when nothing in
 * it would be lost (its branch merged, or no commits of its own and
 * nothing uncommitted), kept otherwise with the reason.
 */

import fs from "fs";
import type { Session } from "../db";
import { getDefaultBranch } from "../git";
import { run } from "../tasks/gh";
import { deleteWorktree, isAgentOSWorktree } from "../worktrees";

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

export async function worktreeFate(
  session: Pick<Session, "worktree_path" | "base_branch">,
  merged: boolean
): Promise<
  | Exclude<WorktreeFate, { action: "removed" }>
  | { action: "remove"; why: string; repo: string }
> {
  const path = session.worktree_path;
  if (!path || !fs.existsSync(path)) return { action: "none" };
  const keep = (why: string) => ({ action: "kept" as const, why, path });
  if (!isAgentOSWorktree(path)) return keep("it isn't an AgentOS worktree");
  const repo = await repoOf(path).catch(() => null);
  if (!repo) return keep("it isn't a git worktree any more");
  if (merged) return { action: "remove", why: "its branch is merged", repo };
  const dirty = await git(path, "status", "--porcelain").catch(() => "?");
  if (dirty) return keep("it has uncommitted changes");
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

// Removes the worktree (and its local branch) when nothing would be lost.
export async function settleWorktree(
  session: Pick<Session, "worktree_path" | "base_branch">,
  merged: boolean
): Promise<WorktreeFate> {
  const fate = await worktreeFate(session, merged);
  if (fate.action !== "remove") return fate;
  await deleteWorktree(session.worktree_path!, fate.repo, true);
  return { action: "removed", why: fate.why };
}
