/**
 * `review`: an independent, read-only review of a task's PR at its exact
 * head commit. A fresh `claude -p` reads a detached checkout of that commit
 * with no edit tools, and its verdict is stored against the sha. When the
 * task came from a card, a second run checks the change against what the
 * card asks for. Both run in the background; the orchestrator hears the
 * verdict as an event.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { Session } from "../db";
import { prFor } from "../tasks/session";
import { run } from "../tasks/gh";
import { queueEvent } from "./events";
import { clearStaleRunning, getCheck, putCheck, type CheckRow } from "./checks";
import { runClaude, type ClaudeRunner } from "./claude-cli";
import { changedFiles } from "./diff";
import { checkScope } from "./scope";
import {
  REVIEW_SCHEMA,
  reviewPrompt,
  REVIEW_SYSTEM,
  toVerdict,
} from "./review-prompt";
import { workspaceTask } from "./targets";
import { expandHome } from "../tasks/session";
import { getProject } from "../projects";

const short = (sha: string) => sha.slice(0, 7);
const DIFF_CAP = 80000;

export function describeReview(row: CheckRow): string {
  const at = short(row.sha);
  if (row.status === "running") return `The review of ${at} is still running.`;
  if (row.status === "error")
    return `The review of ${at} couldn't run: ${row.detail}`;
  const head =
    row.status === "pass"
      ? `Review of ${at}: pass.`
      : `Review of ${at}: blocking findings.`;
  return row.detail ? `${head}\n${row.detail}` : head;
}

export function repoOf(task: Session): string {
  const project = task.project_id ? getProject(task.project_id) : null;
  if (!project) throw new Error("The task has no project");
  return expandHome(project.working_directory);
}

// The task's base on origin, fetched along with its head.
export async function fetchRefs(repo: string, task: Session): Promise<string> {
  const base = task.base_branch || "main";
  await run(
    "git",
    ["fetch", "--quiet", "origin", base, task.branch_name ?? base],
    repo
  ).catch(() => {});
  const remote = `origin/${base}`;
  const has = await run(
    "git",
    ["rev-parse", "--verify", "--quiet", remote],
    repo
  ).then(
    () => true,
    () => false
  );
  return has ? remote : base;
}

// A review skill the repository ships, as a path inside the checkout.
export function reviewSkill(dir: string): string | null {
  for (const sub of [".claude/skills", ".agents/skills"]) {
    const root = path.join(dir, sub);
    if (!fs.existsSync(root)) continue;
    const name = fs.readdirSync(root).find((n) => /review/i.test(n));
    const file = name && path.join(sub, name, "SKILL.md");
    if (file && fs.existsSync(path.join(dir, file))) return file;
  }
  const cmd = path.join(dir, ".claude/commands");
  const md =
    fs.existsSync(cmd) &&
    fs.readdirSync(cmd).find((n) => /review.*\.md$/i.test(n));
  return md ? path.join(".claude/commands", md) : null;
}

async function reviewJob(
  workspaceId: string,
  task: Session,
  sha: string,
  claude: ClaudeRunner
): Promise<CheckRow> {
  const repo = repoOf(task);
  const base = await fetchRefs(repo, task);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-review-"));
  try {
    await run("git", ["worktree", "add", "--detach", dir, sha], repo);
    const files = await changedFiles(repo, base, sha);
    const diff = (
      await run("git", ["diff", "--no-color", `${base}...${sha}`], repo)
    ).slice(0, DIFF_CAP);
    const answer = await claude({
      cwd: dir,
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt({
        task,
        sha,
        base,
        files,
        diff,
        skill: reviewSkill(dir),
      }),
      schema: REVIEW_SCHEMA,
      tools: ["Read", "Grep", "Glob", "Bash"],
      allow: [
        "Read",
        "Grep",
        "Glob",
        "Bash(git diff:*)",
        "Bash(git log:*)",
        "Bash(git show:*)",
      ],
    });
    const verdict = toVerdict(answer);
    const row = putCheck({
      workspaceId,
      sessionId: task.id,
      sha,
      kind: "review",
      ...verdict,
    });
    if (task.lh_card_id)
      await checkScope({ workspaceId, task, sha, files, diff, claude });
    return row;
  } finally {
    await run("git", ["worktree", "remove", "--force", dir], repo).catch(
      () => {}
    );
    fs.rmSync(dir, { recursive: true, force: true });
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
  const pr = await prFor(task, true);
  if (!pr?.head) throw new Error(`${task.name} has no PR to review yet`);
  const sha = pr.head;
  const known = getCheck(task.id, sha, "review");
  if (
    known &&
    (known.status === "running" || (!opts.fresh && known.status !== "error"))
  )
    return describeReview(known);

  putCheck({
    workspaceId,
    sessionId: task.id,
    sha,
    kind: "review",
    status: "running",
  });
  const job = reviewJob(workspaceId, task, sha, opts.claude ?? runClaude)
    .catch((e: unknown) =>
      putCheck({
        workspaceId,
        sessionId: task.id,
        sha,
        kind: "review",
        status: "error",
        detail: e instanceof Error ? e.message : String(e),
      })
    )
    .then((row) => {
      const said =
        row.status === "pass"
          ? "passed"
          : row.status === "block"
            ? "found blocking issues"
            : "couldn't run";
      queueEvent(
        workspaceId,
        `review:${task.id}:${sha}`,
        task.id,
        `task ${task.name}: review of ${short(sha)} ${said}`
      );
      return row;
    });
  if (opts.wait) return describeReview(await job);
  return `Reviewing ${task.name} at ${short(sha)} (PR #${pr.number}) in a fresh read-only process. The verdict arrives as an event; call review again to read it.`;
}
