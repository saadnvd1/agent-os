import fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type Session } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { git, makeRepo } from "@/lib/done/testing";
import type { TaskPR } from "./state";

// Real repositories and worktrees; gh is faked by branch.
const prs = new Map<string, TaskPR>();
const lookups: { branch: string; openOnly?: boolean }[] = [];

vi.mock("./gh", async (importOriginal) => {
  const real = await importOriginal<typeof import("./gh")>();
  const find = async (
    _repo: string,
    branch: string,
    opts: { openOnly?: boolean } = {}
  ) => {
    lookups.push({ branch, openOnly: opts.openOnly });
    const pr = prs.get(branch) ?? null;
    return pr && opts.openOnly && pr.state !== "OPEN" ? null : pr;
  };
  return { ...real, findPR: find, findPRStrict: find };
});

const { prFor } = await import("./session");

const pr = (number: number, state: TaskPR["state"] = "OPEN"): TaskPR => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  state,
  checks: "pass",
});

function seedTask(repo: string, branch: string, worktree: string): Session {
  const project = createProject({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: repo,
  });
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id,
       task_status, branch_name, worktree_path)
     VALUES (?, 'Task', ?, ?, ?, 'running', ?, ?)`
  ).run(id, `claude-${id}`, worktree, project.id, branch, worktree);
  return row(id);
}

const row = (id: string) =>
  db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Session;

beforeEach(() => {
  prs.clear();
  lookups.length = 0;
});

describe("prFor after the task's branch was renamed", () => {
  it("finds the PR on the renamed branch and stores the branch and PR", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/read-and-execute-the-brief-at-2582");
    const task = seedTask(
      r.repo,
      "feature/read-and-execute-the-brief-at-2582",
      wt.dir
    );
    git(wt.dir, "branch", "-m", "feature/schedules-message-a-session-notify");
    prs.set("feature/schedules-message-a-session-notify", pr(114));

    expect((await prFor(task, true))?.number).toBe(114);
    expect(row(task.id)).toMatchObject({
      branch_name: "feature/schedules-message-a-session-notify",
      pr_number: 114,
    });
    expect(lookups).toEqual([
      { branch: "feature/schedules-message-a-session-notify", openOnly: true },
    ]);
  });

  it("repairs a stale row even before the branch has a PR", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old");
    const task = seedTask(r.repo, "feature/old", wt.dir);
    git(wt.dir, "branch", "-m", "feature/mobile-app-expo");

    expect(await prFor(task, true)).toBeNull();
    expect(row(task.id)).toMatchObject({
      branch_name: "feature/mobile-app-expo",
      pr_number: null,
    });

    // The PR opens later: the next poll finds it on the repaired branch.
    prs.set("feature/mobile-app-expo", pr(111));
    expect((await prFor(row(task.id), true))?.number).toBe(111);
    expect(lookups.at(-1)).toEqual({
      branch: "feature/mobile-app-expo",
      openOnly: false,
    });
  });

  it("doesn't link a closed PR someone left on the branch it was renamed to", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old");
    const task = seedTask(r.repo, "feature/old", wt.dir);
    git(wt.dir, "branch", "-m", "feature/reused");
    prs.set("feature/reused", pr(40, "MERGED"));

    expect(await prFor(task, true)).toBeNull();
    expect(row(task.id).pr_number).toBeNull();
  });

  it("leaves a row alone when its worktree is gone", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/gone");
    const task = seedTask(r.repo, "feature/gone", wt.dir);
    fs.rmSync(wt.dir, { recursive: true, force: true });
    prs.set("feature/gone", pr(5, "MERGED"));

    expect((await prFor(task, true))?.number).toBe(5);
    expect(row(task.id).branch_name).toBe("feature/gone");
    expect(lookups).toEqual([{ branch: "feature/gone", openOnly: false }]);
  });

  it("looks up the row's branch as before when nothing was renamed", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/same");
    const task = seedTask(r.repo, "feature/same", wt.dir);
    prs.set("feature/same", pr(6, "MERGED"));

    expect((await prFor(task, true))?.number).toBe(6);
    expect(lookups).toEqual([{ branch: "feature/same", openOnly: false }]);
  });
});
