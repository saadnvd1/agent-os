/**
 * Quick changes: an edit too small for a task (a typo, a config value, a
 * one-file fix) made by the orchestrator itself. quick_change cuts a
 * worktree and branch from the project's default branch, as a task row
 * with no agent (`quick_of` names the orchestrator that owns it); its write
 * guard lets it edit there and nowhere else in a project. quick_pr commits,
 * pushes that branch (never the default one) and opens the PR, which then
 * goes through the same gates as any task's. With no task agent to run
 * /do-code-review, the code-review gate of a PR AgentOS recorded as opened
 * by quick_pr is the independent review of its exact head, never anything
 * its body says. Signed off, dropped or done, it's cleaned up like a task.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import { db, queries, type Session } from "../db";
import { getDefaultBranch, slugify } from "../git";
import { currentBranch, git, revParse } from "../git-exec";
import { isRemoteHost } from "../hosts";
import { createWorktree, deleteWorktree } from "../worktrees";
import { PROTECTED_BRANCHES } from "../tasks/remote-branch";
import { run } from "../tasks/gh";
import { ATTRIBUTION, renderedLines } from "../tasks/code-review";
import { expandHome, forgetPR, prFor, projectPathFor } from "../tasks/session";
import { inBackground } from "../lumifyhub/task-cards";
import type { CheckRow } from "./checks";
import { getOrchestrator } from "./home";
import { fullAccessOn } from "./full-access";
import { setupWorktree } from "../env-setup";
import { addNote } from "./notes";
import { quickWorktrees } from "./quick-store";
import { findWorkspaceSession } from "./read";
import { workspaceProject } from "./targets";
import { recordPr, setTask } from "../db/session-parts";

// Open quick changes one orchestrator may hold at once, unless its workspace
// has Orchestrator full access on (the default).
export const MAX_OPEN_QUICK = 5;

// Git with no hooks: a hook is a script in the project (or one it calls,
// like node_modules/.bin), which the orchestrator could have edited, so a
// commit or push it makes runs none.
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

const short = (sha: string) => sha.slice(0, 7);

export const isQuick = (s: Pick<Session, "quick_of">) => !!s.quick_of;

function ownerOf(workspaceId: string): Session {
  const o = getOrchestrator(workspaceId);
  if (!o) throw new Error("This workspace has no orchestrator yet");
  return o;
}

export async function quickChange(
  workspaceId: string,
  projectRef: string,
  name: string
): Promise<string> {
  return (await startQuickChange(workspaceId, projectRef, name)).text;
}

// The same, for a caller that needs the new session's id and worktree.
export async function startQuickChange(
  workspaceId: string,
  projectRef: string,
  name: string
): Promise<{
  id: string;
  worktreePath: string;
  text: string;
  // Dependencies and the project's setup, running in the background.
  setup: Promise<void>;
}> {
  const owner = ownerOf(workspaceId);
  const project = workspaceProject(workspaceId, projectRef);
  if (isRemoteHost(project.host_id))
    throw new Error(
      `${project.name} runs on another machine; quick changes are made on this one only`
    );
  const open = quickWorktrees(owner.id);
  if (!fullAccessOn(workspaceId) && open.length >= MAX_OPEN_QUICK)
    throw new Error(
      `You have ${open.length} quick changes open (${MAX_OPEN_QUICK} at most): finish one with quick_pr, or drop it, first`
    );
  const label = name.trim();
  const id = randomUUID();
  const projectPath = expandHome(project.working_directory);
  const feature = `quick-${slugify(label.split(/\s+/).slice(0, 6).join(" "))}-${id.slice(0, 4)}`;
  const baseBranch = await getDefaultBranch(projectPath);
  const wt = await createWorktree({
    projectPath,
    featureName: feature,
    baseBranch,
  });
  try {
    db.transaction(() => {
      queries
        .createSession(db)
        .run(
          id,
          label,
          `quick-${id}`,
          wt.worktreePath,
          null,
          project.default_model,
          null,
          "sessions",
          "claude",
          0,
          project.id,
          "local"
        );
      queries
        .updateSessionWorktree(db)
        .run(wt.worktreePath, wt.branchName, baseBranch, null, id);
      db.prepare(
        `UPDATE sessions SET name_source = 'user', view = 'chat' WHERE id = ?`
      ).run(id);
      setTask(db, id, {
        task_prompt: `Quick change: ${label}`,
        task_status: "running",
        quick_of: owner.id,
      });
    })();
  } catch (e) {
    await deleteWorktree(wt.worktreePath, projectPath, true).catch(() => {});
    throw e;
  }
  addNote(
    workspaceId,
    `Quick change "${label}" in ${project.name} on ${wt.branchName}.`
  );
  const full = fullAccessOn(workspaceId);
  const setup = installDependencies(
    workspaceId,
    label,
    wt.worktreePath,
    projectPath
  );
  inBackground(`setup of quick change ${id}`, () => setup);
  return {
    id,
    worktreePath: wt.worktreePath,
    setup,
    text: `Quick change "${label}" (id ${id.slice(0, 8)}) in ${project.name}: worktree ${wt.worktreePath} on ${wt.branchName}, cut from ${baseBranch}. Dependencies are installing in the background (a note says when they're ready). Edit files there with Write and Edit; ${full ? "run any git there" : "git there only as `git -C " + wt.worktreePath + " <status|diff|add|...>`"}. Then quick_pr commits, pushes and opens its PR.`,
  };
}

// The project's own worktree setup (dependencies, env files), so tests and
// the build run in the quick change. One note when it ends.
async function installDependencies(
  workspaceId: string,
  label: string,
  worktreePath: string,
  projectPath: string
): Promise<void> {
  try {
    const r = await setupWorktree({ worktreePath, sourcePath: projectPath });
    const failed = r.steps.find((s) => !s.success);
    addNote(
      workspaceId,
      failed
        ? `Quick change "${label}": setup failed at ${failed.name}: ${failed.error ?? "see its worktree"}.`
        : `Quick change "${label}": dependencies installed, ready to build and test.`
    );
  } catch (e) {
    addNote(
      workspaceId,
      `Quick change "${label}": setup failed: ${(e as Error).message}.`
    );
  }
}

// A quick change of this workspace's orchestrator, by name, id or PR.
export function workspaceQuick(workspaceId: string, ref: string): Session {
  const owner = ownerOf(workspaceId);
  const s = findWorkspaceSession(workspaceId, ref);
  if (s.quick_of !== owner.id)
    throw new Error(
      `${s.name} isn't one of your quick changes; a task's own agent opens its PR`
    );
  if (s.task_status !== "running")
    throw new Error(`${s.name} is already ${s.task_status}`);
  return s;
}

// Why a branch may never be pushed by quick_pr, or null.
export function pushRefusal(
  branch: string | null,
  defaultBranch: string,
  base: string | null
): string | null {
  if (!branch) return "it has no branch";
  if (
    branch === defaultBranch ||
    branch === base ||
    PROTECTED_BRANCHES.has(branch)
  )
    return `its branch is ${branch}, the default branch; quick_pr never pushes to it`;
  return null;
}

const attributed = (text: string) =>
  renderedLines(text).some((l) => ATTRIBUTION.test(l.trimStart()));

export async function quickPR(
  workspaceId: string,
  ref: string,
  title: string,
  body: string
): Promise<{ id: string; text: string }> {
  const s = workspaceQuick(workspaceId, ref);
  const repo = projectPathFor(s);
  const wt = s.worktree_path ? expandHome(s.worktree_path) : null;
  if (!repo || !wt || !fs.existsSync(wt))
    throw new Error(`${s.name}'s worktree is gone; drop it`);
  if (attributed(title) || attributed(body))
    throw new Error("Take the AI attribution out of the title and body");
  const branch = s.branch_name;
  const refusal = pushRefusal(
    branch,
    await getDefaultBranch(repo),
    s.base_branch
  );
  if (refusal) throw new Error(`Refused: ${refusal}.`);
  const on = await currentBranch(wt);
  if (on !== branch)
    throw new Error(
      `Refused: ${s.name}'s worktree is on ${on || "a detached HEAD"}, not its branch ${branch}`
    );
  await git(wt, [...NO_HOOKS, "add", "-A"]);
  const staged = await git(wt, ["diff", "--cached", "--name-only"]);
  if (staged.trim())
    await git(wt, [...NO_HOOKS, "commit", "-q", "-m", title.trim()]);
  const ahead = (
    await git(wt, [
      "rev-list",
      "--count",
      `refs/remotes/origin/${s.base_branch}..HEAD`,
    ]).catch(() => git(wt, ["rev-list", "--count", `${s.base_branch}..HEAD`]))
  ).trim();
  if (ahead === "0")
    throw new Error(`${s.name} has nothing to commit: edit its worktree first`);
  // The branch by its full name on both sides, so nothing but it moves.
  await git(
    wt,
    [
      ...NO_HOOKS,
      "push",
      "--quiet",
      "-u",
      "origin",
      `refs/heads/${branch}:refs/heads/${branch}`,
    ],
    { timeout: 60_000 }
  );
  const head = (await revParse(wt, "HEAD")).trim();
  const goal = `${title.trim()}\n\n${body.trim()}`;
  setTask(db, s.id, { task_prompt: goal });
  const existing = await prFor(s, true);
  if (existing?.state === "OPEN") {
    forgetPR(s.id);
    return {
      id: s.id,
      text: `Pushed ${short(head)} to ${s.name}'s PR #${existing.number} (${existing.url}).`,
    };
  }
  const out = await run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      s.base_branch!,
      "--head",
      branch!,
      "--title",
      title.trim(),
      "--body",
      body.trim(),
    ],
    wt,
    60_000
  );
  const m = /https:\/\/\S+\/pull\/(\d+)/.exec(out);
  if (m) recordPr(db, s.id, { url: m[0], number: Number(m[1]), state: "open" });
  forgetPR(s.id);
  addNote(
    workspaceId,
    `Quick change "${s.name}" opened ${m ? `PR #${m[1]}` : "its PR"} at ${short(head)}.`
  );
  return {
    id: s.id,
    text: `Opened ${m ? `PR #${m[1]} (${m[0]})` : "the PR"} for quick change "${s.name}" at ${short(head)}. It merges only through the gates, like a task's: CI, the independent review of its exact head (which is also its code-review gate, since no task agent ran /do-code-review), scope, then sign_off or arm.`,
  };
}

const QUICK_FIX =
  "for a quick change, the independent review of its exact head is its code review";

// The code-review gate of a PR quick_pr opened (the row's quick_of, never
// its body): the independent review of this exact head. Until it passes the
// quick change waits, before any other gate is judged or counted: a CI that
// wants a Code review section in the body fails until AgentOS writes one
// after the review (noteQuickReview). A blocking review counts once, as the
// review gate's failure, when its verdict arrives.
export function quickCodeReview(
  sha: string,
  review: CheckRow | null,
  rebased = false
): { refusal: null; wait: string | null } {
  if (review?.sha === sha && review.status === "pass")
    return { refusal: null, wait: null };
  const why =
    review?.sha !== sha
      ? rebased
        ? `a rebase moved the branch to ${short(sha)}, so it needs a fresh independent review: call review`
        : `no independent review of ${short(sha)} yet: call review`
      : review.status === "running"
        ? `the review of ${short(sha)} is still running`
        : review.status === "block"
          ? `the review of ${short(sha)} has blocking findings`
          : `the review of ${short(sha)} couldn't run: call review with fresh`;
  return { refusal: null, wait: `${why} (${QUICK_FIX})` };
}

// A PR body section for a repository whose CI wants one (this repo's
// code-review workflow): written by AgentOS after the independent review
// of the head passed, never by the orchestrator. The gate doesn't read it.
const MARK = "<!-- agentos:quick-review -->";

export function withQuickReview(body: string, sha: string): string {
  const at = body.indexOf(MARK);
  const kept = (at < 0 ? body : body.slice(0, at)).trimEnd();
  return `${kept}\n\n${MARK}\n## Code review\nReviewed: ${sha}\nAgents: AgentOS's independent review of this exact commit (a quick change, with no task agent to run /do-code-review)\nFixed: none\nDeferred: none\n`;
}

export function noteQuickReview(reviewed: Session, sha: string): void {
  if (!isQuick(reviewed)) return;
  const task = queries.getSession(db).get(reviewed.id) as Session | undefined;
  if (!task || task.task_status !== "running" || !task.pr_number) return;
  const repo = projectPathFor(task);
  if (!repo) return;
  inBackground(`code review section on quick change ${task.id}`, async () => {
    const pr = await prFor(task, true);
    if (!pr || pr.state !== "OPEN" || pr.head !== sha) return;
    const body = await run(
      "gh",
      ["pr", "view", String(pr.number), "--json", "body", "--jq", ".body"],
      repo
    );
    await run(
      "gh",
      [
        "pr",
        "edit",
        String(pr.number),
        "--body",
        withQuickReview(body.trimEnd(), sha),
      ],
      repo
    );
    forgetPR(task.id);
  });
}
