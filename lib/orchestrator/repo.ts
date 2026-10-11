// The git a review and a sign-off need: the task's repository and base,
// a throwaway checkout of one commit, and the review instructions the
// repository keeps on its base branch.

import fs from "fs";
import os from "os";
import path from "path";
import type { Session } from "../db";
import { SKILL_DIRS } from "../agents/skill-dirs";
import { getDefaultBranch } from "../git";
import { getProject } from "../projects";
import {
  git,
  gitFetch,
  gitOk,
  isGitError,
  worktreeAdd,
  worktreeRemove,
} from "../git-exec";
import { expandHome } from "../tasks/session";

export function repoOf(task: Session): string {
  const project = task.project_id ? getProject(task.project_id) : null;
  if (!project) throw new Error("The task has no project");
  return expandHome(project.working_directory);
}

// The task's base on origin, fetched along with its head. The base is the
// PR's own (prFor records GitHub's baseRefName on the task). A base gone
// from origin (a stacked parent's branch, deleted) falls back to the
// project's default branch, and so does one that can't be found at all, so
// a diff never names a missing revision.
export async function fetchRefs(
  repo: string,
  task: Pick<Session, "base_branch" | "branch_name">
): Promise<string> {
  const head = task.branch_name ? [task.branch_name] : [];
  const recorded = task.base_branch || null;
  if (recorded) {
    const fetched = await fetchBranches(repo, [recorded, ...head]);
    // A base gone on origin fails the fetch, so the head goes on its own.
    if (fetched === "gone" && head.length)
      requireFetched(await fetchBranches(repo, head));
    requireFetched(fetched);
    if (fetched !== "gone") {
      const found = await existingRef(repo, recorded);
      if (found) return found;
    }
  }
  const fallback = await getDefaultBranch(repo);
  if (fallback !== recorded) {
    requireFetched(
      await fetchBranches(repo, recorded ? [fallback] : [fallback, ...head])
    );
    const found = await existingRef(repo, fallback);
    if (found) return found;
  }
  throw new Error(
    `Neither the base ${recorded ?? "(none recorded)"} nor the default branch ${fallback} can be found`
  );
}

// An unreachable origin leaves the tracking refs as they were, and a diff
// against a stale base can hide or invent changes, so the gates stop.
function requireFetched(result: "ok" | "gone" | "failed"): void {
  if (result === "failed")
    throw new Error("Couldn't fetch from origin, so the base can't be trusted");
}

// "gone" when origin answered that the first branch isn't there; any other
// failure is "failed" (origin unreachable).
async function fetchBranches(
  repo: string,
  branches: string[]
): Promise<"ok" | "gone" | "failed"> {
  try {
    // In English whatever the locale: the message is read below.
    await gitFetch(repo, ["--quiet", "--", "origin", ...branches], {
      env: { LC_ALL: "C" },
    });
    return "ok";
  } catch (error) {
    const stderr = isGitError(error) ? error.stderr : "";
    return stderr.includes(`couldn't find remote ref ${branches[0]}`)
      ? "gone"
      : "failed";
  }
}

// origin/<branch> when it's there, else a local <branch>.
async function existingRef(
  repo: string,
  branch: string
): Promise<string | null> {
  for (const ref of [`origin/${branch}`, branch])
    if (
      await gitOk(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    )
      return ref;
  return null;
}

// When the commit was made, in seconds.
export async function commitTime(repo: string, sha: string): Promise<number> {
  const out = await git(repo, ["show", "-s", "--format=%ct", sha]);
  return Number(out.trim()) || 0;
}

// Review agents whose rules are a checklist (the verifier and spec
// compliance are steps of /do-code-review, not checks of the code).
const AGENT_RULES =
  /^\.claude\/agents\/review-(?!finding-verifier|spec-compliance)[^/]+\.md$/;
const CHECKLIST_CAP = 40000;

// The repository's review instructions as its BASE branch has them, never
// as the PR under review would rewrite them: the Rules of its review
// agents when it has them (/do-code-review itself is a process for a
// session with agents and a shell, which the reviewer doesn't have), else
// a review skill.
export async function baseReviewSkill(
  repo: string,
  base: string
): Promise<{ path: string; text: string } | null> {
  const listed = await git(repo, [
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "--",
    ".claude/agents",
    ...SKILL_DIRS,
  ]).catch(() => "");
  const files = listed.split("\n").map((f) => f.trim());
  const agents = files.filter((f) => AGENT_RULES.test(f));
  if (agents.length) {
    const parts = await Promise.all(
      agents.map(async (f) => {
        const text = await git(repo, ["show", `${base}:${f}`]);
        return `## ${f.slice(".claude/agents/".length, -3)}\n${rulesOf(text)}`;
      })
    );
    return {
      path: ".claude/agents/review-*.md",
      text: parts.join("\n\n").slice(0, CHECKLIST_CAP),
    };
  }
  const file = files.find(
    (f) =>
      !f.startsWith(".claude/agents/") &&
      /(^|\/)[^/]*review[^/]*(\/SKILL\.md|\.md)$/i.test(f)
  );
  if (!file) return null;
  const text = await git(repo, ["show", `${base}:${file}`]);
  return { path: file, text: text.slice(0, 20000) };
}

// An agent file's "## Rules" section, or all of it when it has none.
function rulesOf(text: string): string {
  const start = text.search(/^## Rules\s*$/m);
  if (start < 0) return text.trim();
  const rest = text.slice(start).replace(/^## Rules\s*\n/, "");
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

// A detached checkout of one commit with every symlink removed, so nothing
// in it can point a reader outside it. Its real path, for permission rules.
export async function checkout(repo: string, sha: string): Promise<string> {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "aos-review-"))
  );
  await worktreeAdd(repo, ["--detach", dir, sha]);
  const staged = await git(dir, ["ls-files", "-s"]);
  for (const line of staged.split("\n"))
    if (line.startsWith("120000 "))
      fs.rmSync(path.join(dir, line.split("\t")[1]), { force: true });
  return dir;
}

export async function removeCheckout(repo: string, dir: string) {
  await worktreeRemove(repo, dir).catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
