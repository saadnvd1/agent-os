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
  stageFile,
  unstageFile,
} from "./git-status";

let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "first");
  fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
  fs.writeFileSync(path.join(repo, "b.txt"), "new\n");
  fs.writeFileSync(path.join(repo, "c.txt"), "staged\n");
  git("add", "c.txt");
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(`${repo}-origin.git`, { recursive: true, force: true });
});

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

  it("counts commits ahead of and behind the upstream", async () => {
    const origin = `${repo}-origin.git`;
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    git("remote", "add", "origin", origin);
    git("push", "-q", "-u", "origin", "main");
    git("commit", "-q", "-m", "second");
    git("commit", "-q", "--allow-empty", "-m", "third");
    expect(await getGitStatus(repo)).toMatchObject({ ahead: 2, behind: 0 });
    git("push", "-q");
    git("reset", "-q", "--soft", "HEAD~1");
    expect(await getGitStatus(repo)).toMatchObject({ ahead: 0, behind: 1 });
  });

  it("stages and unstages a file whose name is shell syntax, as a name", async () => {
    const name = "$(id>pwned)`id>pwned2`.txt";
    fs.writeFileSync(path.join(repo, name), "x\n");
    await stageFile(repo, name);
    expect((await getGitStatus(repo)).staged.map((f) => f.path)).toContain(
      name
    );
    await unstageFile(repo, name);
    expect(fs.existsSync(path.join(repo, "pwned"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "pwned2"))).toBe(false);
    fs.rmSync(path.join(repo, name));
  });

  it("fails loudly outside a repository", async () => {
    await expect(getGitStatus(os.tmpdir())).rejects.toThrow(
      "Failed to get git status"
    );
  });
});
