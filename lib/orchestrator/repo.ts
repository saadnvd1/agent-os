// The git a review and a sign-off need: the task's repository and base,
// a throwaway checkout of one commit, and the review instructions the
// repository keeps on its base branch.

import fs from "fs";
import os from "os";
import path from "path";
import type { Session } from "../db";
import { SKILL_DIRS } from "../agents/skill-dirs";
import { getProject } from "../projects";
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";

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

// When the commit was made, in seconds.
export async function commitTime(repo: string, sha: string): Promise<number> {
  const out = await run("git", ["show", "-s", "--format=%ct", sha], repo);
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
  const listed = await run(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      base,
      "--",
      ".claude/agents",
      ...SKILL_DIRS,
    ],
    repo
  ).catch(() => "");
  const files = listed.split("\n").map((f) => f.trim());
  const agents = files.filter((f) => AGENT_RULES.test(f));
  if (agents.length) {
    const parts = await Promise.all(
      agents.map(async (f) => {
        const text = await run("git", ["show", `${base}:${f}`], repo);
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
  const text = await run("git", ["show", `${base}:${file}`], repo);
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
  await run("git", ["worktree", "add", "--detach", dir, sha], repo);
  const staged = await run("git", ["ls-files", "-s"], dir);
  for (const line of staged.split("\n"))
    if (line.startsWith("120000 "))
      fs.rmSync(path.join(dir, line.split("\t")[1]), { force: true });
  return dir;
}

export async function removeCheckout(repo: string, dir: string) {
  await run("git", ["worktree", "remove", "--force", dir], repo).catch(
    () => {}
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
