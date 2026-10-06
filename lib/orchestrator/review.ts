/**
 * `review`: an independent, read-only review of a task's PR at its exact
 * head commit. A fresh `claude -p` (claude-cli.ts) reads a symlink-free
 * detached checkout of that commit, with Read/Grep/Glob limited to it and no
 * shell, and its verdict is stored against the sha. When the task came from
 * a card, a second run checks the change against the card. A diff too big
 * to read whole goes to Saad instead of being judged on a part. Both run in
 * the background; the orchestrator hears the verdict as an event.
 */

import type { Session } from "../db";
import type { TaskPR } from "../tasks/state";
import { prFor } from "../tasks/session";
import { run } from "../tasks/gh";
import { queueEvent } from "./events";
import { clearStaleRunning, getCheck, putCheck, type CheckRow } from "./checks";
import { runClaude, type ClaudeRunner } from "./claude-cli";
import { changedFiles } from "./diff";
import { escalate } from "./escalate";
import { escalations } from "./gates";
import {
  baseReviewSkill,
  checkout,
  fetchRefs,
  removeCheckout,
  repoOf,
} from "./repo";
import {
  REVIEW_SCHEMA,
  reviewPrompt,
  REVIEW_SYSTEM,
  toVerdict,
} from "./review-prompt";
import { checkScope } from "./scope";
import { workspaceTask } from "./targets";
import { untrusted } from "./untrusted";

const short = (sha: string) => sha.slice(0, 7);
// The most diff a reviewer is given; more goes to Saad.
export const DIFF_CAP = 80000;

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

async function reviewJob(
  workspaceId: string,
  task: Session,
  pr: TaskPR,
  sha: string,
  claude: ClaudeRunner
): Promise<CheckRow> {
  const row = { workspaceId, sessionId: task.id, sha };
  const repo = repoOf(task);
  const base = await fetchRefs(repo, task);
  const diff = await run(
    "git",
    ["diff", "--no-color", `${base}...${sha}`],
    repo
  );
  if (diff.length > DIFF_CAP) {
    const why = `PR #${pr.number}'s diff at ${short(sha)} is ${diff.length} characters, too big to review whole`;
    escalate(workspaceId, task, "size", why, pr.url, sha);
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
    const answer = await claude({
      cwd: dir,
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt({ task, sha, base, files, diff, skill }),
      schema: REVIEW_SCHEMA,
      tools: ["Read", "Grep", "Glob"],
      allow: [`Read(/${dir}/**)`, `Grep(/${dir}/**)`, `Glob(/${dir}/**)`],
    });
    const done = putCheck({ ...row, kind: "review", ...toVerdict(answer) });
    if (task.lh_card_id)
      await checkScope({ workspaceId, task, sha, files, diff, claude });
    return done;
  } finally {
    await removeCheckout(repo, dir);
  }
}

export async function review(
  workspaceId: string,
  ref: string,
  opts: { fresh?: boolean; wait?: boolean; claude?: ClaudeRunner } = {}
): Promise<string> {
  clearStaleRunning();
  const task = workspaceTask(workspaceId, ref);
  if (task.task_status !== "running")
    throw new Error(`${task.name} is already ${task.task_status}`);
  const held = escalations(task.id);
  if (held.length)
    return `${task.name} is with Saad (${held.map((h) => h.gate).join(", ")}); no review needed from you.`;
  const pr = await prFor(task, true);
  if (!pr?.head) throw new Error(`${task.name} has no PR to review yet`);
  const sha = pr.head;
  const known = getCheck(task.id, sha, "review");
  if (
    known &&
    (known.status === "running" || (!opts.fresh && known.status !== "error"))
  )
    return describeReview(known);

  const row = { workspaceId, sessionId: task.id, sha, kind: "review" as const };
  putCheck({ ...row, status: "running" });
  const job = reviewJob(workspaceId, task, pr, sha, opts.claude ?? runClaude)
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
        `review:${task.id}:${sha}`,
        task.id,
        `task ${task.name}: review of ${short(sha)} ${said}`
      );
      return done;
    });
  if (opts.wait) return describeReview(await job);
  return `Reviewing ${task.name} at ${short(sha)} (PR #${pr.number}) in a fresh read-only process. The verdict arrives as an event; call review again to read it.`;
}
