import { db, type Session } from "../db";
import { deleteWorktree } from "../worktrees";
import {
  syncTaskCardInBackground,
  inBackground,
} from "../lumifyhub/task-cards";
import { republishAfterMerge } from "../lumifyhub/publish";
import { restackAfterMerge } from "../stacks/restack";
import { hasLiveChildren, signOffRefusal } from "../stacks/guard";
import { run } from "./gh";
import { canSignOff } from "./state";
import { forgetPR, getTaskSession, prFor, projectPathFor } from "./session";

async function cleanup(
  session: Session,
  repo: string,
  keepRemoteBranch = false
): Promise<void> {
  await run(
    "tmux",
    ["kill-session", "-t", `=${session.tmux_name}`],
    repo
  ).catch(() => {});
  if (session.worktree_path) {
    await deleteWorktree(session.worktree_path, repo, true).catch(() => {});
  }
  // A stacked child's PR targets this branch: deleting it on origin would
  // make GitHub close that PR, and a closed PR can't be retargeted.
  if (session.branch_name && !keepRemoteBranch) {
    await run(
      "git",
      ["push", "origin", "--delete", session.branch_name],
      repo
    ).catch(() => {});
  }
  await run("git", ["fetch", "--prune", "--quiet"], repo).catch(() => {});
  forgetPR(session.id);
}

// Squash-merge the PR, restack anything stacked on it, then remove the
// session, worktree and branches. The checks are re-read here: the button is
// not the guard.
export async function signOffTask(id: string): Promise<void> {
  const session = getTaskSession(id);
  if (session.task_status !== "running")
    throw new Error(`Task is already ${session.task_status}`);
  const repo = projectPathFor(session);
  if (!repo) throw new Error("Task has no project");
  const refusal = signOffRefusal(id);
  if (refusal) throw new Error(refusal);
  const pr = await prFor(session, true);
  const verdict = canSignOff(pr);
  if (!verdict.ok) throw new Error(verdict.reason);
  await run(
    "gh",
    ["pr", "merge", String(pr!.number), "--squash"],
    repo,
    120000
  );
  db.prepare(
    `UPDATE sessions SET task_status = 'merged', pr_status = 'merged' WHERE id = ?`
  ).run(id);
  syncTaskCardInBackground(session, "merged", pr);
  // Before cleanup deletes this branch on origin: children are retargeted
  // first. One that could not be moved keeps the branch alive.
  const { stuck } = await restackAfterMerge(id).catch((error: unknown) => {
    console.error(`[stacks] restack after ${id}:`, error);
    return { stuck: true };
  });
  await cleanup(session, repo, stuck);
  // After cleanup's fetch, so the base branch holds the merged files.
  inBackground(`re-publish docs after task ${id}`, () =>
    republishAfterMerge(session)
  );
}

// Reject the work: close the PR if there is one and remove everything.
export async function dropTask(id: string): Promise<void> {
  const session = getTaskSession(id);
  if (session.task_status !== "running")
    throw new Error(`Task is already ${session.task_status}`);
  const repo = projectPathFor(session);
  if (!repo) throw new Error("Task has no project");
  const pr = await prFor(session, true);
  if (pr?.state === "OPEN") {
    await run("gh", ["pr", "close", String(pr.number)], repo).catch(() => {});
  }
  db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
    id
  );
  db.prepare(
    `UPDATE stack_items SET status = 'dropped' WHERE session_id = ?`
  ).run(id);
  syncTaskCardInBackground(session, "dropped", pr);
  await cleanup(session, repo, hasLiveChildren(id));
}
