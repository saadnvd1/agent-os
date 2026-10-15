// Test fixtures for task PR lookups: real repositories and worktrees, with
// gh faked by branch.

import { db, insertSessionRow, type Session } from "../db";
import { createProject } from "../projects";
import type { FindPROpts } from "./gh";
import type { TaskPR } from "./state";

export type FakePR = TaskPR & { createdAt: string };

// gh pr list --head, as findPR asks it: same repo only, no older than
// `since`.
export function fakeFindPR(
  prs: Map<string, FakePR>,
  lookups: ({ branch: string } & FindPROpts)[]
) {
  return async (_repo: string, branch: string, opts: FindPROpts = {}) => {
    lookups.push({ branch, ...opts });
    const pr = prs.get(branch);
    if (!pr) return null;
    if (opts.since && Date.parse(pr.createdAt) < Date.parse(opts.since))
      return null;
    const { createdAt: _, ...found } = pr;
    return found;
  };
}

export const fakePR = (
  number: number,
  {
    state = "OPEN",
    createdAt = new Date(Date.now() + 60_000).toISOString(),
    head,
  }: { state?: TaskPR["state"]; createdAt?: string; head?: string } = {}
): FakePR => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  state,
  checks: "pass",
  head,
  createdAt,
});

export const LONG_AGO = "2020-01-01T00:00:00Z";

export function seedTask(
  repo: string,
  branch: string,
  worktree: string
): Session {
  const project = createProject({
    name: `p-${crypto.randomUUID().slice(0, 6)}`,
    workingDirectory: repo,
  });
  const id = crypto.randomUUID();
  insertSessionRow(db, {
    id,
    name: "Read and execute the brief",
    tmux_name: `claude-${id}`,
    working_directory: worktree,
    project_id: project.id,
    task_status: "running",
    branch_name: branch,
    base_branch: "main",
    worktree_path: worktree,
  });
  return taskRow(id);
}

export const taskRow = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Session;
