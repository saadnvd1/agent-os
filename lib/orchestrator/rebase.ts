/**
 * Automatic rebase. When the base moves under a task's PR and GitHub says it
 * now conflicts (read in the PR poll AgentOS already makes, so no extra
 * call), `git merge-tree` says whether the PR's head merges cleanly with the
 * base as fetched, without touching any checkout.
 *
 * Clean: the branch is rebased onto the base in the task's own worktree,
 * only while its agent is idle with nothing uncommitted, and pushed to the
 * task's own branch with a lease on the commit fetched (the restack's code,
 * stacks/git.ts). The base itself and every other branch are never written.
 * The heads are recorded, and when the PR's own patch is unchanged (same
 * `git patch-id` against the base before and after), the orchestrator's
 * review of the old head carries over to the new one (tasks/code-review.ts);
 * otherwise a fresh one starts.
 *
 * Not clean, or not rebasable (uncommitted work, commits only on origin):
 * the task is asked once, per head, to rebase by hand. The orchestrator
 * hears one event either way.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { sendMessage } from "../bus";
import { getDefaultBranch } from "../git";
import { hostLink } from "../hosts/remote-api";
import type { TaskPR } from "../tasks/state";
import { run } from "../tasks/gh";
import { isAllowedBase } from "../tasks/session";
import { git as runGit, gitFetch, revParse } from "../git-exec";
import { comparePatches } from "./patch";
import { outputOf, type Runner } from "../stacks/git";
import { restackedHeads, stackNotice } from "../stacks/restack";
import { getCheck, putCheck } from "./checks";
import { queueEvent } from "./events";
import { statusOf, type SessionFacts } from "./facts";
import { isPaused } from "./pause";
import { repoOf } from "./repo";
import { reviewAt, taskReviewTarget } from "./review";

const short = (sha: string) => sha.slice(0, 7);

export interface RebaseDeps {
  runner: Runner;
  // Message the task's agent; it arrives as its next prompt.
  send: (taskId: string, body: string) => Promise<void>;
  // Whether its agent is idle right now (not mid-turn, not waiting).
  idle: (task: Session) => Promise<boolean>;
  // Start a review of exactly this head.
  review: (
    workspaceId: string,
    task: Session,
    pr: TaskPR,
    sha: string
  ) => Promise<unknown>;
}

const defaults: RebaseDeps = {
  runner: (cmd, args, cwd) => run(cmd, args, cwd, 120000),
  send: async (to, body) => {
    await sendMessage(stackNotice(to, body, "AgentOS"));
  },
  idle: async (task) => (await statusOf(task)).status === "idle",
  review: (w, task, pr, sha) =>
    reviewAt(w, taskReviewTarget(task, { ...pr, head: sha }), sha),
};

// The (head, base tip) pairs already rebased or found not to need it, so a
// stale "conflicting" from GitHub isn't acted on again.
const tried = new Map<string, string>();

const sessionRow = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;

// Every open task PR in the workspace that conflicts with its base.
export async function rebaseConflicting(
  workspaceId: string,
  facts: SessionFacts[],
  deps: RebaseDeps = defaults
): Promise<void> {
  if (isPaused(workspaceId)) return;
  for (const f of facts) {
    if (isPaused(workspaceId)) return;
    const pr = f.task?.pr;
    // A stack item moves with its stack (stacks/restack.ts).
    if (pr?.state !== "OPEN" || pr.mergeable !== "CONFLICTING" || f.stack)
      continue;
    const task = sessionRow(f.id);
    if (
      !task ||
      task.task_status !== "running" ||
      !task.branch_name ||
      !pr.head ||
      task.rebase_asked_head === pr.head ||
      hostLink(task.host_id)
    )
      continue;
    try {
      await rebaseOne(workspaceId, task, { ...pr, head: pr.head }, f, deps);
    } catch (error) {
      console.error(`Automatic rebase of ${task.name}:`, error);
    }
  }
}

// Whether `head` merges cleanly into `base`: git's own merge, written to
// the object store only, no checkout touched.
export async function mergesCleanly(
  repo: string,
  base: string,
  head: string
): Promise<boolean> {
  try {
    await runGit(repo, ["merge-tree", "--write-tree", base, head]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

async function rebaseOne(
  workspaceId: string,
  task: Session,
  pr: TaskPR & { head: string },
  f: SessionFacts,
  deps: RebaseDeps
): Promise<void> {
  const repo = repoOf(task);
  // The PR's base as GitHub has it now, not the one the task started on.
  // Only a base AgentOS would judge the task against: a branch the task
  // picked itself could carry commits nobody reviewed.
  if (pr.base && !(await isAllowedBase(task, repo, pr.base))) return;
  const branch = pr.base || task.base_branch || (await getDefaultBranch(repo));
  // A failed fetch throws: nothing is judged against a stale base.
  await gitFetch(repo, ["--quiet", "--", "origin", branch, task.branch_name!], {
    timeout: 60000,
  });
  const onto = `origin/${branch}`;
  const baseTip = await revParse(repo, onto);
  const attempt = `${pr.head}:${baseTip}`;
  if (tried.get(task.id) === attempt) return;

  if (!(await mergesCleanly(repo, onto, pr.head))) {
    tried.set(task.id, attempt);
    return askToRebase(
      workspaceId,
      task,
      pr,
      branch,
      `its changes conflict with ${branch}`,
      deps
    );
  }
  // Never mid-turn: tried again on a later diff once its agent is idle.
  const wt = task.worktree_path;
  if (!wt || !fs.existsSync(wt)) return;
  if (f.status !== "idle" || !(await deps.idle(task))) return;
  tried.set(task.id, attempt);
  const git = (cwd: string, ...args: string[]) =>
    deps.runner("git", args, cwd).then((out) => out.trim());
  // Only the commit the PR is at, with nothing on top: work the task hasn't
  // committed or pushed is its own to rebase.
  const local = async () => {
    const [head, dirty] = await Promise.all([
      git(wt, "rev-parse", "HEAD"),
      git(wt, "status", "--porcelain"),
    ]);
    return dirty
      ? "its worktree has uncommitted changes"
      : head !== pr.head
        ? "its worktree has commits the PR doesn't"
        : null;
  };
  const unsafe = await local();
  if (unsafe) return askToRebase(workspaceId, task, pr, branch, unsafe, deps);

  // Rebased in a throwaway checkout of the PR's head, never in the task's
  // own: a turn that starts meanwhile can't get its work into the push.
  // Git's own words name the task's commits and files: they go to the
  // log, and a fixed reason goes to the task and the orchestrator.
  const rebased = await rebaseAt(repo, pr.head, onto, deps).catch(
    (error: unknown) => {
      console.error(`Rebasing ${task.name}:`, outputOf(error));
      return {
        error: `replaying its commits one by one onto ${branch} conflicts`,
      };
    }
  );
  if ("error" in rebased)
    return askToRebase(workspaceId, task, pr, branch, rebased.error, deps);
  const to = rebased.sha;
  // GitHub's word was stale: nothing to move.
  if (to === pr.head || isPaused(workspaceId)) return;

  // Recorded before the push, so a restart in between can't lose it, and
  // put back if the push is refused.
  const before = [task.rebased_from ?? null, task.rebased_to ?? null];
  const heads = restackedHeads(
    {
      restacked_from: task.rebased_from ?? null,
      restacked_to: task.rebased_to ?? null,
    },
    { from: pr.head, to, unpushed: false }
  );
  db.prepare(
    `UPDATE sessions SET rebased_from = ?, rebased_to = ? WHERE id = ?`
  ).run(heads.restacked_from, heads.restacked_to, task.id);
  // Only the task's own branch, and only if origin still has the head
  // that was judged. --no-verify: CI runs on the PR.
  const pushed = await git(
    repo,
    "push",
    "--no-verify",
    `--force-with-lease=refs/heads/${task.branch_name}:${pr.head}`,
    "origin",
    `${to}:refs/heads/${task.branch_name}`
  ).then(
    () => null,
    (error: unknown) => outputOf(error)
  );
  if (pushed !== null) {
    console.error(`Pushing ${task.name}'s rebase:`, pushed);
    db.prepare(
      `UPDATE sessions SET rebased_from = ?, rebased_to = ? WHERE id = ?`
    ).run(...before, task.id);
    return askToRebase(
      workspaceId,
      task,
      pr,
      branch,
      "pushing the rebase was refused, so its branch may have moved on origin",
      deps
    );
  }
  // The task's worktree follows while it's still idle and untouched;
  // otherwise the task is told how to catch up.
  const follows =
    (await deps.idle(task)) &&
    !(await local()) &&
    (await catchUp(git, wt, task.branch_name!, pr.head, to));
  if (!follows && !task.quick_of)
    await deps.send(
      task.id,
      `AgentOS rebased your branch ${task.branch_name} onto ${branch} on origin (now ${short(to)}), because PR #${pr.number} conflicted with it. Your worktree is still on the old head: before changing anything, run \`git fetch origin && git reset --keep origin/${task.branch_name}\` (commit your work first). Its review carries over when its own patch didn't change.`
    );
  const reviewed = await carryReview(workspaceId, task, pr, onto, to, deps);
  queueEvent(
    workspaceId,
    `rebased:${task.id}:${to}`,
    task.id,
    `task ${task.name}: PR #${pr.number} conflicted with ${branch}; AgentOS rebased it cleanly (${short(pr.head)} -> ${short(to)}) and pushed it. CI runs again; ${reviewed}.`
  );
}

// Moves the worktree's branch from `from` to `to` only if it's still at
// `from` (update-ref compares and swaps, so a commit made since stops it),
// then brings its index and files along (a two-tree read-tree, which
// refuses to overwrite local edits). Put back if the files can't follow.
async function catchUp(
  git: (cwd: string, ...args: string[]) => Promise<string>,
  wt: string,
  branch: string,
  from: string,
  to: string
): Promise<boolean> {
  const ref = `refs/heads/${branch}`;
  const ok = (p: Promise<unknown>) =>
    p.then(
      () => true,
      () => false
    );
  if (!(await ok(git(wt, "update-ref", ref, to, from)))) return false;
  if (await ok(git(wt, "read-tree", "-m", "-u", from, to))) return true;
  await ok(git(wt, "update-ref", ref, from, to));
  return false;
}

// `head` rebased onto `onto` in a detached throwaway worktree, which is
// removed after. Rejects when the rebase stops on a conflict.
async function rebaseAt(
  repo: string,
  head: string,
  onto: string,
  deps: RebaseDeps
): Promise<{ sha: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-rebase-"));
  try {
    await deps.runner("git", ["worktree", "add", "--detach", dir, head], repo);
    try {
      await deps.runner("git", ["rebase", onto], dir);
    } catch (error) {
      await deps.runner("git", ["rebase", "--abort"], dir).catch(() => "");
      throw error;
    }
    return {
      sha: (await deps.runner("git", ["rev-parse", "HEAD"], dir)).trim(),
    };
  } finally {
    await deps
      .runner("git", ["worktree", "remove", "--force", dir], repo)
      .catch(() => "");
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The review of the head before the rebase, carried to the new head when
// the PR's own patch is the same, else a fresh review of the new head.
async function carryReview(
  workspaceId: string,
  task: Session,
  pr: TaskPR & { head: string },
  onto: string,
  to: string,
  deps: RebaseDeps
): Promise<string> {
  const from = pr.head;
  const prior = getCheck(task.id, from, "review");
  const scope = getCheck(task.id, from, "scope");
  const repo = repoOf(task);
  const { same } = await comparePatches(repo, onto, from, to);
  if (
    same &&
    prior?.status === "pass" &&
    (!task.lh_card_id || scope?.status === "pass")
  ) {
    const why = `Carried over from ${short(from)}: AgentOS rebased it onto ${onto} and the PR's own patch is unchanged (same git patch-id).`;
    for (const row of [prior, scope])
      if (row)
        putCheck({
          workspaceId,
          sessionId: task.id,
          sha: to,
          kind: row.kind,
          status: "pass",
          detail: `${row.detail ?? ""}\n${why}`.trim(),
        });
    return `the review of ${short(from)} carries over (same patch)`;
  }
  void deps.review(workspaceId, task, pr, to).catch(() => {});
  return same
    ? `${short(from)} had no passing review, so a review of ${short(to)} started`
    : `its patch changed in the rebase, so a fresh review of ${short(to)} started`;
}

async function askToRebase(
  workspaceId: string,
  task: Session,
  pr: TaskPR & { head: string },
  base: string,
  why: string,
  deps: RebaseDeps
): Promise<void> {
  // Claimed first: a restart mid-send doesn't ask twice.
  db.prepare(`UPDATE sessions SET rebase_asked_head = ? WHERE id = ?`).run(
    pr.head,
    task.id
  );
  // A quick change has no agent to ask: it's the orchestrator's to redo.
  if (task.quick_of) {
    queueEvent(
      workspaceId,
      `conflict:${task.id}:${pr.head}`,
      task.id,
      `quick change ${task.name}: PR #${pr.number} conflicts with ${base} and can't be rebased automatically (${why.slice(0, 300)}). Drop it and make the change again in a new quick change.`
    );
    return;
  }
  queueEvent(
    workspaceId,
    `conflict:${task.id}:${pr.head}`,
    task.id,
    `task ${task.name}: PR #${pr.number} conflicts with ${base} and can't be rebased automatically (${why.slice(0, 300)}); asked it once to rebase.`
  );
  await deps.send(
    task.id,
    `Your PR #${pr.number} conflicts with ${base}, and AgentOS couldn't rebase it for you: ${why.slice(0, 300)}. At your next stopping point: commit your work, run \`git fetch origin && git rebase origin/${base}\`, resolve the conflicts, re-run your checks, push with \`git push --force-with-lease\`. The orchestrator reviews the new head.`
  );
}
