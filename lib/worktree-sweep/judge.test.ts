import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { commitFile, git, makeRepo, WORKTREE_MARK } from "@/lib/done/testing";

vi.mock("@/lib/worktrees", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worktrees")>()),
  isAgentOSWorktree: (p: string) => p.includes(WORKTREE_MARK),
}));

const { judgeWorktree } = await import("./judge");

const reason = (v: { remove: boolean; reason?: string }) =>
  v.remove ? "" : (v.reason ?? "");

describe("judgeWorktree", () => {
  it("removes a clean worktree whose commits are pushed", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/a", { "a.txt": "a\n" });
    expect(
      await judgeWorktree(wt.dir, r.repo, { branch: "feature/a" })
    ).toEqual({ remove: true });
  });

  it("keeps one with an uncommitted change or an untracked file", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/b");
    fs.writeFileSync(path.join(wt.dir, "README.md"), "edited\n");
    expect(reason(await judgeWorktree(wt.dir, r.repo))).toMatch(/uncommitted/);
    git(wt.dir, "checkout", "--", "README.md");
    fs.writeFileSync(path.join(wt.dir, "new.txt"), "x\n");
    expect(reason(await judgeWorktree(wt.dir, r.repo))).toMatch(/new\.txt/);
  });

  it("keeps one with a commit no remote has", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/c");
    commitFile(wt.dir, "c.txt", "c\n");
    expect(
      reason(await judgeWorktree(wt.dir, r.repo, { branch: "feature/c" }))
    ).toMatch(/1 commit no remote branch or merged PR has/);
  });

  it("removes one whose commit is in the merged PR's head", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/d");
    const head = commitFile(wt.dir, "d.txt", "d\n");
    expect(
      await judgeWorktree(wt.dir, r.repo, { branch: "feature/d", prHead: head })
    ).toEqual({ remove: true });
  });

  it("removes one whose patch landed upstream under another hash", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/e");
    const sha = commitFile(wt.dir, "e.txt", "e\n");
    git(r.repo, "cherry-pick", sha);
    git(r.repo, "push", "-q", "origin", "main");
    expect(
      await judgeWorktree(wt.dir, r.repo, { branch: "feature/e" })
    ).toEqual({ remove: true });
  });

  it("keeps one when git can't read it", async () => {
    const r = makeRepo();
    const wt = r.worktree("feature/f");
    const gone = path.join(path.dirname(wt.dir), "not-a-repo");
    fs.mkdirSync(gone);
    expect(reason(await judgeWorktree(gone, r.repo))).toMatch(
      /can't be checked/
    );
  });
});
