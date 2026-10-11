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
 * The heads are recorded so the task's Code review section still covers
 * the new head (tasks/code-review.ts), and the section gets a "Restacked:"
 * line for CI. When the PR's own patch is unchanged (same `git patch-id`
 * against the base before and after), the orchestrator's review of the old
 * head carries over; otherwise a fresh one starts.
 *
 * Not clean, or not rebasable (uncommitted work, commits only on origin):
 * the task is asked once, per head, to rebase by hand. The orchestrator
 * hears one event either way.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { db, type Session } from "../db";
import { sendMessage } from "../bus";
import { hostLink } from "../hosts/remote-api";
import type { TaskPR } from "../tasks/state";
import { run } from "../tasks/gh";
import { withRestackedLine } from "../tasks/code-review";
import { restackBranch, type Runner } from "../stacks/git";
import { restackedHeads, stackNotice } from "../stacks/restack";
import { getCheck, putCheck } from "./checks";
import { queueEvent } from "./events";
import { statusOf, type SessionFacts } from "./facts";
import { isPaused } from "./pause";
import { fetchRefs, repoOf } from "./repo";
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
  // Add the Restacked line to the PR body's Code review section.
  editBody: (
    repo: string,
    pr: number,
    from: string,
    to: string
  ) => Promise<void>;
}

async function editBody(repo: string, pr: number, from: string, to: string) {
  const body = await run(
    "gh",
    ["pr", "view", String(pr), "--json", "body", "--jq", ".body"],
    repo,
    15000
  );
  const next = withRestackedLine(body.replace(/\n$/, ""), from, to);
  if (!next) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-body-"));
  const file = path.join(dir, "body.md");
  try {
    fs.writeFileSync(file, next);
    await run(
      "gh",
      ["pr", "edit", String(pr), "--body-file", file],
      repo,
      30000
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const defaults: RebaseDeps = {
  runner: (cmd, args, cwd) => run(cmd, args, cwd, 120000),
  send: async (to, body) => {
    await sendMessage(stackNotice(to, body, "AgentOS"));
  },
  idle: async (task) => (await statusOf(task)).status === "idle",
  review: (w, task, pr, sha) =>
    reviewAt(w, taskReviewTarget(task, { ...pr, head: sha }), sha),
  editBody,
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
    await run("git", ["merge-tree", "--write-tree", base, head], repo);
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
  const branch = task.base_branch || "main";
  const onto = await fetchRefs(repo, task);
  if (onto !== `origin/${branch}`) return;
  const baseTip = (await run("git", ["rev-parse", onto], repo)).trim();
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
  const git = (...args: string[]) =>
    deps.runner("git", args, wt).then((out) => out.trim());
  // Only the commit the PR is at, with nothing on top: work the task hasn't
  // committed or pushed is its own to rebase.
  const [head, dirty] = await Promise.all([
    git("rev-parse", "HEAD"),
    git("status", "--porcelain"),
  ]);
  if (head !== pr.head || dirty)
    return askToRebase(
      workspaceId,
      task,
      pr,
      branch,
      dirty
        ? "its worktree has uncommitted changes"
        : "its worktree has commits the PR doesn't",
      deps
    );

  const moved: { to?: string; unpushed?: boolean } = {};
  const result = await restackBranch(
    {
      name: task.name,
      repo,
      worktree: wt,
      branch: task.branch_name!,
      oldTip: await git("merge-base", onto, "HEAD"),
      onto: branch,
      retargetPr: null,
      beforePush: async (m) => {
        Object.assign(moved, m);
        const heads = restackedHeads(
          {
            restacked_from: task.rebased_from ?? null,
            restacked_to: task.rebased_to ?? null,
          },
          m
        );
        db.prepare(
          `UPDATE sessions SET rebased_from = ?, rebased_to = ? WHERE id = ?`
        ).run(heads.restacked_from, heads.restacked_to, task.id);
        if (heads.restacked_from && heads.restacked_to)
          await deps
            .editBody(repo, pr.number, heads.restacked_from, heads.restacked_to)
            .catch(() => {});
      },
    },
    deps.runner
  ).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!result.ok)
    return askToRebase(workspaceId, task, pr, branch, result.error, deps);
  // GitHub's word was stale: nothing moved.
  const { to, unpushed } = moved;
  if (!to) return;
  const reviewed = unpushed
    ? "it had commits the task never pushed, so nothing reviewed carries over"
    : await carryReview(workspaceId, task, pr, onto, to, deps);
  queueEvent(
    workspaceId,
    `rebased:${task.id}:${to}`,
    task.id,
    `task ${task.name}: PR #${pr.number} conflicted with ${branch}; AgentOS rebased it cleanly (${short(pr.head)} -> ${short(to)}) and pushed it. CI runs again; ${reviewed}.`
  );
}

// The PR's own patch against the base, as `git patch-id` sees it.
async function patchId(repo: string, range: string): Promise<string | null> {
  const diff = await run(
    "git",
    ["diff", "--no-color", "--no-ext-diff", "--full-index", range],
    repo
  ).catch(() => null);
  if (!diff) return null;
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      ["patch-id", "--stable"],
      { cwd: repo, timeout: 30000 },
      (error, out) => resolve(error ? null : out.split(" ")[0] || null)
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(diff);
  });
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
  const [before, after] = await Promise.all([
    patchId(repo, `${onto}...${from}`),
    patchId(repo, `${onto}...${to}`),
  ]);
  const same = !!before && before === after;
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
  queueEvent(
    workspaceId,
    `conflict:${task.id}:${pr.head}`,
    task.id,
    `task ${task.name}: PR #${pr.number} conflicts with ${base} and can't be rebased automatically (${why.slice(0, 300)}); asked it once to rebase.`
  );
  await deps.send(
    task.id,
    `Your PR #${pr.number} conflicts with ${base}, and AgentOS couldn't rebase it for you: ${why.slice(0, 300)}. At your next stopping point: commit your work, run \`git fetch origin && git rebase origin/${base}\`, resolve the conflicts, re-run your checks, push with \`git push --force-with-lease\`, then run /do-code-review again and update the Code review section for the new head.`
  );
}
