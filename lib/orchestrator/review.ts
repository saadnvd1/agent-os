/**
 * `review`: an independent, read-only review of a task's PR at its exact
 * head commit. A fresh `claude -p` (claude-cli.ts) reads a symlink-free
 * detached checkout of that commit, with Read/Grep/Glob limited to it and no
 * shell, and its verdict is stored against the sha. When the task came from
 * a card, a second run checks the change against the card. A diff too big
 * to read whole is reviewed in parts (diff-parts.ts), each against the task,
 * and fails if any part does; with merge approvals on it goes to Saad
 * instead, as does one too big even in parts. Both run in the background;
 * the orchestrator hears the verdict as an event.
 */

import { db, type Session } from "../db";
import type { TaskPR } from "../tasks/state";
import { prFor } from "../tasks/session";
import { EXTERNAL_PREFIX } from "./asks";
import { queueEvent } from "./events";
import { clearStaleRunning, getCheck, putCheck, type CheckRow } from "./checks";
import { runClaude, type ClaudeRunner } from "./claude-cli";
import { changedFiles, fullDiff } from "./diff";
import { diffParts } from "./diff-parts";
import { escalate } from "./escalate";
import { holdingEscalations } from "./gates";
import { mergeApprovalsOn } from "./merge-approvals";
import {
  baseReviewSkill,
  checkout,
  fetchRefs,
  removeCheckout,
  repoOf,
} from "./repo";
import {
  combineVerdicts,
  REVIEW_SCHEMA,
  reviewPrompt,
  REVIEW_SYSTEM,
  toVerdict,
} from "./review-prompt";
import { checkScope } from "./scope";
import { workspaceTask } from "./targets";
import { untrusted } from "./untrusted";

const short = (sha: string) => sha.slice(0, 7);
// The most diff one reviewer is given, and the most parts a change too big
// for one is cut into; more goes to Saad.
export const DIFF_CAP = 80000;
export const MAX_PARTS = 6;

export function describeReview(row: CheckRow): string {
  const at = short(row.sha);
  if (row.status === "running") return `The review of ${at} is still running.`;
  if (row.status === "error")
    return `The review of ${at} couldn't run: ${row.detail}`;
  const head =
    row.status === "pass"
      ? `Review of ${at}: pass.`
      : `Review of ${at}: blocking findings.`;
  return row.detail ? `${head}\n${untrusted("reviewer", row.detail)}` : head;
}

// What a review reads: a task's PR, or a PR no task owns (external-pr.ts).
// `id` keys its stored checks; `task` is set only for a task, whose card
// gets a scope check.
export interface ReviewTarget {
  id: string;
  name: string;
  // How its events and answers name it: "task add-a", "PR o/r#5".
  label: string;
  goal: string;
  repo: string;
  refs: Pick<Session, "base_branch" | "branch_name">;
  pr: Pick<TaskPR, "number" | "url">;
  task?: Session;
}

async function reviewJob(
  workspaceId: string,
  target: ReviewTarget,
  sha: string,
  claude: ClaudeRunner
): Promise<CheckRow> {
  const { pr, repo, task } = target;
  const row = { workspaceId, sessionId: target.id, sha };
  const base = await fetchRefs(repo, target.refs);
  const diff = await fullDiff(repo, base, sha);
  const parts =
    diff.length <= DIFF_CAP
      ? [diff]
      : mergeApprovalsOn()
        ? null
        : diffParts(diff, DIFF_CAP, MAX_PARTS);
  if (!parts) {
    const approvals = mergeApprovalsOn();
    const why = `PR #${pr.number}'s diff at ${short(sha)} is ${diff.length} characters, too big to review ${approvals ? "whole" : `in ${MAX_PARTS} parts of ${DIFF_CAP}`}`;
    // "size" is the approval merge approvals asks for; "unreviewable" holds
    // the task whatever that switch says.
    escalate(
      workspaceId,
      target,
      approvals ? "size" : "unreviewable",
      why,
      pr.url,
      sha
    );
    return putCheck({
      ...row,
      kind: "review",
      status: "error",
      detail: `${why}; it's with Saad`,
    });
  }
  const files = await changedFiles(repo, base, sha);
  const skill = await baseReviewSkill(repo, base);
  const dir = await checkout(repo, sha);
  try {
    const verdicts = [];
    for (const [i, part] of parts.entries()) {
      // Each part can take its own 15 minutes: a fresh row each time keeps
      // a long review from reading as one a restart left behind.
      if (i > 0)
        putCheck({
          ...row,
          kind: "review",
          status: "running",
          detail: `part ${i + 1} of ${parts.length}`,
        });
      const answer = await claude({
        cwd: dir,
        system: REVIEW_SYSTEM,
        prompt: reviewPrompt({
          goal: target.goal,
          sha,
          base,
          files,
          diff: part,
          skill,
          ...(parts.length > 1 ? { part: { n: i + 1, of: parts.length } } : {}),
        }),
        schema: REVIEW_SCHEMA,
        tools: ["Read", "Grep", "Glob"],
        allow: [`Read(/${dir}/**)`, `Grep(/${dir}/**)`, `Glob(/${dir}/**)`],
      });
      verdicts.push(toVerdict(answer));
    }
    const done = putCheck({
      ...row,
      kind: "review",
      ...combineVerdicts(verdicts),
    });
    if (task?.lh_card_id)
      await checkScope({ workspaceId, task, sha, files, parts, claude });
    return done;
  } finally {
    await removeCheckout(repo, dir);
  }
}

export interface ReviewOpts {
  fresh?: boolean;
  wait?: boolean;
  claude?: ClaudeRunner;
  // At startup: a "running" review is one the restart cut off.
  resume?: boolean;
}

// The stored verdict of this exact commit, or a review of it started in
// the background.
export async function reviewAt(
  workspaceId: string,
  target: ReviewTarget,
  sha: string,
  opts: ReviewOpts = {}
): Promise<string> {
  const known = getCheck(target.id, sha, "review");
  // A card task's scope check runs after its review; one never stored (a
  // restart between the two) means running the job again.
  const scopeMissing =
    !!target.task?.lh_card_id &&
    known?.status !== "running" &&
    !getCheck(target.id, sha, "scope");
  if (
    known &&
    !(opts.resume && known.status === "running") &&
    !scopeMissing &&
    (known.status === "running" || (!opts.fresh && known.status !== "error"))
  )
    return describeReview(known);

  const row = {
    workspaceId,
    sessionId: target.id,
    sha,
    kind: "review" as const,
  };
  putCheck({ ...row, status: "running" });
  const job = reviewJob(workspaceId, target, sha, opts.claude ?? runClaude)
    .catch((e: unknown) =>
      putCheck({
        ...row,
        status: "error",
        detail: e instanceof Error ? e.message : String(e),
      })
    )
    .then((done) => {
      const said =
        done.status === "pass"
          ? "passed"
          : done.status === "block"
            ? "found blocking issues"
            : "couldn't run";
      queueEvent(
        workspaceId,
        `review:${target.id}:${sha}`,
        target.id,
        `${target.label}: review of ${short(sha)} ${said}`
      );
      return done;
    });
  if (opts.wait) return describeReview(await job);
  return `Reviewing ${target.name} at ${short(sha)} (PR #${target.pr.number}) in a fresh read-only process. The verdict arrives as an event; call review again to read it.`;
}

export async function review(
  workspaceId: string,
  ref: string,
  opts: ReviewOpts = {}
): Promise<string> {
  clearStaleRunning();
  const task = workspaceTask(workspaceId, ref);
  if (task.task_status !== "running")
    throw new Error(`${task.name} is already ${task.task_status}`);
  const held = holdingEscalations(task.id);
  if (held.length)
    return `${task.name} is with Saad (${held.map((h) => h.gate).join(", ")}); no review needed from you.`;
  const pr = await prFor(task, true);
  if (!pr?.head) throw new Error(`${task.name} has no PR to review yet`);
  return reviewAt(
    workspaceId,
    {
      id: task.id,
      name: task.name,
      label: `task ${task.name}`,
      goal: task.task_prompt ?? task.name,
      repo: repoOf(task),
      refs: task,
      pr,
      task,
    },
    pr.head,
    opts
  );
}

const INTERRUPTED = "Interrupted by a restart";

// At startup. A review is a job in the server, so one still "running" was
// cut off by the restart: it runs again on its task's PR, and its verdict
// arrives as an event like any other. A commit that isn't reviewed again
// (the task has pushed since, or finished) gets an event saying so. Each
// row stays "running" until it's decided, so a restart in the middle of
// this leaves the rest for the next start.
export async function resumeReviews(
  claude: ClaudeRunner = runClaude
): Promise<string[]> {
  const cut = db
    .prepare(
      `SELECT DISTINCT c.workspace_id, c.session_id, s.name
       FROM orchestrator_checks c LEFT JOIN sessions s ON s.id = c.session_id
       WHERE c.status = 'running' AND c.kind IN ('review', 'scope')
         AND (s.id IS NOT NULL OR c.session_id LIKE '${EXTERNAL_PREFIX}%')`
    )
    .all() as {
    workspace_id: string;
    session_id: string;
    name: string | null;
  }[];
  const resumed: string[] = [];
  for (const row of cut) {
    const shas = (
      db
        .prepare(
          `SELECT DISTINCT sha FROM orchestrator_checks
           WHERE session_id = ? AND status = 'running' AND kind IN ('review', 'scope')`
        )
        .all(row.session_id) as { sha: string }[]
    ).map((r) => r.sha);
    // Marked, still running: a new run of the same commit clears the mark.
    db.prepare(
      `UPDATE orchestrator_checks SET detail = ?
       WHERE session_id = ? AND status = 'running' AND kind = 'review'`
    ).run(INTERRUPTED, row.session_id);
    // The job runs a missing scope check again.
    db.prepare(
      `DELETE FROM orchestrator_checks
       WHERE session_id = ? AND status = 'running' AND kind = 'scope'`
    ).run(row.session_id);
    let why: string;
    try {
      // A PR no task owns may have moved on or merged by now: it's
      // reviewed again when the orchestrator asks.
      if (row.session_id.startsWith(EXTERNAL_PREFIX))
        throw new Error("a PR no task owns is reviewed again only when asked");
      why = await review(row.workspace_id, row.session_id, {
        claude,
        resume: true,
      });
      resumed.push(row.session_id);
    } catch (error) {
      why = error instanceof Error ? error.message : String(error);
    }
    // What the new run didn't claim stays cut off.
    db.prepare(
      `UPDATE orchestrator_checks SET status = 'error'
       WHERE session_id = ? AND kind = 'review' AND status = 'running' AND detail = ?`
    ).run(row.session_id, INTERRUPTED);
    for (const sha of shas) {
      const now = getCheck(row.session_id, sha, "review");
      if (now && now.status !== "error") continue;
      queueEvent(
        row.workspace_id,
        `review:${row.session_id}:${sha}`,
        row.session_id,
        `${row.name ? `task ${row.name}` : `PR ${row.session_id.slice(EXTERNAL_PREFIX.length)}`}: review of ${short(sha)} was cut off by a restart and not run again: ${why}`
      );
    }
  }
  return resumed;
}
