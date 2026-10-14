import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { git, makeRepo } from "@/lib/done/testing";
import { preparePlanDir, PLAN_FILE } from "@/lib/models/plan-step";
import { snapshotRef, snapshotWorktree } from "./snapshot";

describe("snapshotWorktree", () => {
  it("saves tracked changes, untracked files and the ignored plan under a hidden ref, touching nothing", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/snap", { "a.txt": "one\n" });
    fs.writeFileSync(path.join(wt.dir, "a.txt"), "two\n");
    fs.writeFileSync(path.join(wt.dir, "new.txt"), "new\n");
    fs.writeFileSync(
      path.join(wt.dir, "huge.bin"),
      Buffer.alloc(1024 * 1024 + 1)
    );
    preparePlanDir(wt.dir);
    fs.writeFileSync(path.join(wt.dir, PLAN_FILE), "plan\n");
    const statusBefore = git(wt.dir, "status", "--porcelain");

    const commit = await snapshotWorktree(wt.dir, "sess-1");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(git(r.repo, "rev-parse", snapshotRef("sess-1"))).toBe(commit);
    expect(git(r.repo, "rev-parse", `${commit}^`)).toBe(wt.head);
    const files = git(r.repo, "ls-tree", "-r", "--name-only", commit!);
    expect(files).toContain("new.txt");
    expect(files).toContain(PLAN_FILE);
    expect(files).not.toContain("huge.bin");
    expect(git(r.repo, "show", `${commit}:a.txt`)).toBe("two");

    // The worktree, its index and its branch are as they were.
    expect(git(wt.dir, "status", "--porcelain")).toBe(statusBefore);
    expect(git(wt.dir, "diff", "--cached", "--name-only")).toBe("");
    expect(git(wt.dir, "rev-parse", "HEAD")).toBe(wt.head);
  });

  it("never throws, whatever it's given", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-nogit-"));
    expect(await snapshotWorktree(dir, "x")).toBeNull();
    expect(await snapshotWorktree(null, "x")).toBeNull();
    expect(await snapshotWorktree("/does/not/exist", "x")).toBeNull();
  });
});
