import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getFileDiff,
  getGitStatus,
  getUntrackedFileDiff,
  isGitRepo,
} from "./git-status";

let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "first");
  fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
  fs.writeFileSync(path.join(repo, "b.txt"), "new\n");
  fs.writeFileSync(path.join(repo, "c.txt"), "staged\n");
  git("add", "c.txt");
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("git status, off the event loop", () => {
  it("knows a repository from a plain directory", async () => {
    expect(await isGitRepo(repo)).toBe(true);
    expect(await isGitRepo(os.tmpdir())).toBe(false);
  });

  it("reads branch, staged, unstaged and untracked, with no upstream", async () => {
    const status = await getGitStatus(repo);
    expect(status.branch).toBe("main");
    expect([status.ahead, status.behind]).toEqual([0, 0]);
    expect(status.staged.map((f) => f.path)).toEqual(["c.txt"]);
    expect(status.unstaged.map((f) => f.path)).toEqual(["a.txt"]);
    expect(status.untracked.map((f) => f.path)).toEqual(["b.txt"]);
  });

  it("diffs a changed file, a staged one and an untracked one", async () => {
    expect(await getFileDiff(repo, "a.txt", false)).toContain("+two");
    expect(await getFileDiff(repo, "c.txt", true)).toContain("+staged");
    // git exits 1 when an untracked file differs from /dev/null.
    expect(await getUntrackedFileDiff(repo, "b.txt")).toContain("+new");
  });

  it("fails loudly outside a repository", async () => {
    await expect(getGitStatus(os.tmpdir())).rejects.toThrow(
      "Failed to get git status"
    );
  });
});
