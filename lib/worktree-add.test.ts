import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { git } from "./git-exec";
import { addWorktree, GitCryptLockedError, usesGitCrypt } from "./worktree-add";

const run = (args: string[], cwd: string) => git(cwd, args);
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

let root: string;
let repo: string;

// A smudge filter that fails unless the key is reachable through the
// worktree's own git dir, as git-crypt's is.
function makeRepo(crypt: boolean) {
  sh(root, "init", "-q", "-b", "main", repo);
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
  if (crypt) {
    sh(repo, "config", "filter.fake.clean", "cat");
    sh(
      repo,
      "config",
      "filter.fake.smudge",
      'test -f "$(git rev-parse --absolute-git-dir)/git-crypt/keys/default" && cat'
    );
    fs.writeFileSync(
      path.join(repo, ".gitattributes"),
      "secret.txt filter=fake\n"
    );
  }
  fs.writeFileSync(path.join(repo, "secret.txt"), "plain\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "init");
}

const unlock = () => {
  const keys = path.join(repo, ".git", "git-crypt", "keys");
  fs.mkdirSync(keys, { recursive: true });
  fs.writeFileSync(path.join(keys, "default"), "KEY");
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aos-crypt-")));
  repo = path.join(root, "repo");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("addWorktree", () => {
  it("links the key into a git-crypt worktree and checks files out", async () => {
    makeRepo(true);
    unlock();
    const dir = path.join(root, "wt");
    await addWorktree(run, repo, dir, "main", ["-b", "feat"]);
    expect(fs.readFileSync(path.join(dir, "secret.txt"), "utf8")).toBe(
      "plain\n"
    );
    expect(sh(dir, "branch", "--show-current").trim()).toBe("feat");
    expect(sh(dir, "status", "--porcelain").trim()).toBe("");
    const link = path.join(
      sh(dir, "rev-parse", "--absolute-git-dir").trim(),
      "git-crypt"
    );
    expect(usesGitCrypt(dir)).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("removing the worktree leaves the key intact", async () => {
    makeRepo(true);
    unlock();
    const dir = path.join(root, "wt");
    await addWorktree(run, repo, dir, "main", ["--detach"]);
    sh(repo, "worktree", "remove", "--force", dir);
    expect(
      fs.readFileSync(path.join(repo, ".git/git-crypt/keys/default"), "utf8")
    ).toBe("KEY");
    // and a second worktree still works
    await addWorktree(run, repo, path.join(root, "wt2"), "main", ["--detach"]);
    sh(repo, "worktree", "prune");
    expect(fs.existsSync(path.join(repo, ".git/git-crypt/keys/default"))).toBe(
      true
    );
  });

  it("leaves a repo without git-crypt as a plain add", async () => {
    makeRepo(false);
    const dir = path.join(root, "wt");
    await addWorktree(run, repo, dir, "main", ["-b", "feat"]);
    expect(fs.existsSync(path.join(dir, "secret.txt"))).toBe(true);
    expect(usesGitCrypt(dir)).toBe(false);
  });

  it("refuses a locked repo with a clear message and makes nothing", async () => {
    makeRepo(true);
    fs.mkdirSync(path.join(repo, ".git", "git-crypt", "keys"), {
      recursive: true,
    });
    const dir = path.join(root, "wt");
    const err = await addWorktree(run, repo, dir, "main", ["-b", "feat"]).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(GitCryptLockedError);
    expect(err.message).toBe("repo is git-crypt locked; unlock it first");
    expect(fs.existsSync(dir)).toBe(false);
    expect(sh(repo, "branch", "--list", "feat").trim()).toBe("");
  });
});
