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

let ghDown = false;

vi.mock("./gh", async (importOriginal) => {
  const find = fakeFindPR(prs, lookups);
  return {
    ...(await importOriginal<typeof import("./gh")>()),
    findPR: async (...a: Parameters<typeof find>) =>
      ghDown ? null : find(...a),
    findPRStrict: async (...a: Parameters<typeof find>) => {
      if (ghDown) throw new Error("HTTP 502 from api.github.com");
      return find(...a);
    },
  };
});

const { isoUTC, prFor } = await import("./session");

beforeEach(() => {
  ghDown = false;
  prs.clear();
  lookups.length = 0;
});

describe("prFor after the task's branch was renamed", () => {
  it("finds the PR on the renamed branch and stores the branch and PR", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/read-and-execute-the-brief-at-2582", {
      "work.txt": "task work\n",
    });
    const task = seedTask(
      r.repo,
      "feature/read-and-execute-the-brief-at-2582",
      wt.dir
    );
    git(wt.dir, "branch", "-m", "feature/schedules-message-a-session-notify");
    prs.set(
      "feature/schedules-message-a-session-notify",
      fakePR(114, { head: wt.head })
    );

    expect((await prFor(task, true))?.number).toBe(114);
    expect(taskRow(task.id)).toMatchObject({
      branch_name: "feature/schedules-message-a-session-notify",
      pr_number: 114,
    });
    expect(lookups.map((l) => l.branch)).toEqual([
      "feature/schedules-message-a-session-notify",
    ]);
  });

  it("repairs a stale row even before the branch has a PR", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old", { "work.txt": "task work\n" });
    const task = seedTask(r.repo, "feature/old", wt.dir);
    git(wt.dir, "branch", "-m", "feature/mobile-app-expo");

    expect(await prFor(task, true)).toBeNull();
    expect(taskRow(task.id)).toMatchObject({
      branch_name: "feature/mobile-app-expo",
      pr_number: null,
    });

    // The PR opens later: the next poll finds it on the repaired branch.
    prs.set("feature/mobile-app-expo", fakePR(111, { head: wt.head }));
    expect((await prFor(taskRow(task.id), true))?.number).toBe(111);
    expect(taskRow(task.id).pr_number).toBe(111);
  });

  it("never links a PR the branch name had before the task, on any poll", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/old");
    const task = seedTask(r.repo, "feature/old", wt.dir);
    git(wt.dir, "branch", "-m", "feature/reused");
    prs.set(
      "feature/reused",
      fakePR(40, { state: "MERGED", createdAt: LONG_AGO })
    );

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

  it("doesn't follow a rename onto a branch whose PR isn't the task's work", async () => {
    const r = makeRepo();
    const theirs = r.worktree("feature/theirs", { "theirs.txt": "x\n" });
    git(r.repo, "worktree", "remove", "--force", theirs.dir);
    git(r.repo, "branch", "-D", "feature/theirs");
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    git(wt.dir, "branch", "-m", "feature/theirs");
    prs.set("feature/theirs", fakePR(77, { head: theirs.head }));

    expect(await prFor(task, true)).toBeNull();
    expect(await prFor(taskRow(task.id), true)).toBeNull();
    expect(taskRow(task.id)).toMatchObject({
      branch_name: "feature/mine",
      pr_number: null,
    });
  });

  it("doesn't follow a rename onto a branch with someone's merged PR", async () => {
    const r = makeRepo();
    const theirs = r.worktree("feature/theirs", { "theirs.txt": "x\n" });
    git(r.repo, "worktree", "remove", "--force", theirs.dir);
    git(r.repo, "branch", "-D", "feature/theirs");
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    git(wt.dir, "branch", "-m", "feature/theirs");
    prs.set(
      "feature/theirs",
      fakePR(78, { state: "MERGED", head: theirs.head })
    );

    expect(await prFor(task, true)).toBeNull();
    expect(await prFor(taskRow(task.id), true)).toBeNull();
    expect(taskRow(task.id)).toMatchObject({
      branch_name: "feature/mine",
      pr_number: null,
    });
  });

  it("doesn't link a PR whose head isn't the task's work, even unrenamed", async () => {
    const r = makeRepo();
    const other = r.worktree("feature/other", { "o.txt": "x\n" });
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    prs.set("feature/mine", fakePR(79, { head: other.head }));

    expect(await prFor(task, true)).toBeNull();
    expect(taskRow(task.id).pr_number).toBeNull();
  });

  it("leaves the row put when gh can't answer for a renamed branch", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    git(wt.dir, "branch", "-m", "feature/renamed");
    ghDown = true;

    expect(await prFor(task, true)).toBeNull();
    await expect(prFor(taskRow(task.id), true, true)).rejects.toThrow(/502/);
    expect(taskRow(task.id).branch_name).toBe("feature/mine");

    ghDown = false;
    await prFor(taskRow(task.id), true);
    expect(taskRow(task.id).branch_name).toBe("feature/renamed");
  });

  it("doesn't follow a rename onto the base branch", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    db.prepare(
      `UPDATE sessions SET base_branch = 'feature/base' WHERE id = ?`
    ).run(task.id);
    git(wt.dir, "branch", "-m", "feature/base");

    await prFor(taskRow(task.id), true);
    expect(taskRow(task.id).branch_name).toBe("feature/mine");
    expect(lookups.map((l) => l.branch)).toEqual(["feature/mine"]);
  });

  it("doesn't read a worktree path for a session on another host", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    db.prepare(`UPDATE sessions SET host_id = 'remote-1' WHERE id = ?`).run(
      task.id
    );
    git(wt.dir, "branch", "-m", "feature/renamed");

    await prFor(taskRow(task.id), true);
    expect(taskRow(task.id).branch_name).toBe("feature/mine");
  });

  it("takes a newer PR on the task's branch over a closed one", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine", { "work.txt": "task work\n" });
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    db.prepare(`UPDATE sessions SET pr_number = 150 WHERE id = ?`).run(task.id);
    prs.set("feature/mine", fakePR(151, { head: wt.head }));

    expect((await prFor(taskRow(task.id), true))?.number).toBe(151);
    expect(taskRow(task.id).pr_number).toBe(151);
  });

  it("asks only for PRs opened since the task started, in UTC", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/mine");
    const task = seedTask(r.repo, "feature/mine", wt.dir);
    db.prepare(
      `UPDATE sessions SET created_at = '2026-10-07 11:00:00', pr_number = 9 WHERE id = ?`
    ).run(task.id);

    await prFor(taskRow(task.id), true);
    expect(lookups[0].since).toBe("2026-10-07T11:00:00Z");
    expect(isoUTC("2026-10-07T11:00:00Z")).toBe("2026-10-07T11:00:00Z");
  });

  it("leaves a row alone when its worktree is gone", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/gone");
    const task = seedTask(r.repo, "feature/gone", wt.dir);
    fs.rmSync(wt.dir, { recursive: true, force: true });
    prs.set("feature/gone", fakePR(5, { state: "MERGED" }));

    expect((await prFor(task, true))?.number).toBe(5);
    expect(taskRow(task.id).branch_name).toBe("feature/gone");
    expect(lookups[0]).toMatchObject({
      branch: "feature/gone",
    });
  });

  it("finds a merged PR on an unrenamed branch as before", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/same", { "work.txt": "task work\n" });
    const task = seedTask(r.repo, "feature/same", wt.dir);
    prs.set("feature/same", fakePR(6, { state: "MERGED", head: wt.head }));

    expect((await prFor(task, true))?.number).toBe(6);
    expect(lookups[0]).toMatchObject({
      branch: "feature/same",
    });
  });
});
