import fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { git, makeRepo } from "@/lib/done/testing";
import type { FindPROpts } from "./gh";
import {
  fakeFindPR,
  fakePR,
  LONG_AGO,
  seedTask,
  taskRow,
  type FakePR,
} from "./testing";

const prs = new Map<string, FakePR>();
const lookups: ({ branch: string } & FindPROpts)[] = [];

vi.mock("./gh", async (importOriginal) => {
  const find = fakeFindPR(prs, lookups);
  return {
    ...(await importOriginal<typeof import("./gh")>()),
    findPR: find,
    findPRStrict: find,
  };
});

const { prFor } = await import("./session");

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
    prs.set("feature/schedules-message-a-session-notify", fakePR(114));

    expect((await prFor(task, true))?.number).toBe(114);
    expect(taskRow(task.id)).toMatchObject({
      branch_name: "feature/schedules-message-a-session-notify",
      pr_number: 114,
    });
    expect(lookups[0]).toMatchObject({
      branch: "feature/schedules-message-a-session-notify",
      openOnly: true,
    });
  });

  it("repairs a stale row even before the branch has a PR", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old");
    const task = seedTask(r.repo, "feature/old", wt.dir);
    git(wt.dir, "branch", "-m", "feature/mobile-app-expo");

    expect(await prFor(task, true)).toBeNull();
    expect(taskRow(task.id)).toMatchObject({
      branch_name: "feature/mobile-app-expo",
      pr_number: null,
    });

    // The PR opens later: the next poll finds it on the repaired branch.
    prs.set("feature/mobile-app-expo", fakePR(111));
    expect((await prFor(taskRow(task.id), true))?.number).toBe(111);
    expect(taskRow(task.id).pr_number).toBe(111);
  });

  it("never links a PR the branch name had before the task, on any poll", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old");
    const task = seedTask(r.repo, "feature/old", wt.dir);
    git(wt.dir, "branch", "-m", "feature/reused");
    prs.set("feature/reused", fakePR(40, "MERGED", LONG_AGO));

    expect(await prFor(task, true)).toBeNull();
    expect(await prFor(taskRow(task.id), true)).toBeNull();
    expect(taskRow(task.id).pr_number).toBeNull();
  });

  it("doesn't follow a checkout of some other branch", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    git(wt.dir, "switch", "-q", "-c", "feature/theirs");
    prs.set("feature/theirs", fakePR(140));

    expect(await prFor(task, true)).toBeNull();
    expect(taskRow(task.id).branch_name).toBe("feature/mine");
    expect(lookups.map((l) => l.branch)).toEqual(["feature/mine"]);
  });

  it("doesn't take a branch another session has", async () => {
    const r = makeRepo();
    const other = r.worktree("feature/other");
    seedTask(r.repo, "feature/other", other.dir);
    // Its worktree and local branch are gone; the row still names it.
    git(r.repo, "worktree", "remove", "--force", other.dir);
    git(r.repo, "branch", "-D", "feature/other");
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    git(wt.dir, "branch", "-m", "feature/other");

    await prFor(task, true);
    expect(taskRow(task.id).branch_name).toBe("feature/mine");
  });

  it("doesn't store a branch name a shell would read as more", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    git(wt.dir, "branch", "-m", 'a"$(id)"b');

    await prFor(task, true);
    expect(taskRow(task.id).branch_name).toBe("feature/mine");
  });

  it("never swaps a task's PR for another one on its branch", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    db.prepare(`UPDATE sessions SET pr_number = 150 WHERE id = ?`).run(task.id);
    prs.set("feature/mine", fakePR(90, "MERGED", LONG_AGO));

    expect(await prFor(taskRow(task.id), true)).toBeNull();
    await expect(prFor(taskRow(task.id), true, true)).rejects.toThrow(
      /PR #90, not the task's #150/
    );
    expect(taskRow(task.id).pr_number).toBe(150);
  });

  it("leaves a row alone when its worktree is gone", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/gone");
    const task = seedTask(r.repo, "feature/gone", wt.dir);
    fs.rmSync(wt.dir, { recursive: true, force: true });
    prs.set("feature/gone", fakePR(5, "MERGED"));

    expect((await prFor(task, true))?.number).toBe(5);
    expect(taskRow(task.id).branch_name).toBe("feature/gone");
    expect(lookups[0]).toMatchObject({
      branch: "feature/gone",
      openOnly: false,
    });
  });

  it("finds a merged PR on an unrenamed branch as before", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/same");
    const task = seedTask(r.repo, "feature/same", wt.dir);
    prs.set("feature/same", fakePR(6, "MERGED"));

    expect((await prFor(task, true))?.number).toBe(6);
    expect(lookups[0]).toMatchObject({
      branch: "feature/same",
      openOnly: false,
    });
  });
});
