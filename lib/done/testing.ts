// Test repositories for done: a clone with a local bare remote, and
// worktrees cut from it the way AgentOS cuts them.

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

// Old enough that CI counts as settled on every commit.
const env = { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env,
  }).trim();

export function commitFile(cwd: string, file: string, text: string): string {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", `change ${file}`);
  return git(cwd, "rev-parse", "HEAD");
}

// Worktrees live under a folder whose name marks them as AgentOS's.
export const WORKTREE_MARK = "aos-done-wt";

export function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-done-repo-"));
  const remote = path.join(root, "remote.git");
  const repo = path.join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, repo);
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "T");
  commitFile(repo, "README.md", "hello\n");
  git(repo, "push", "-q", "origin", "HEAD");
  const trees = path.join(root, WORKTREE_MARK);
  fs.mkdirSync(trees);
  let n = 0;
  return {
    repo,
    // A worktree on a new branch from main, with these commits on it.
    worktree(branch: string, commits: Record<string, string> = {}) {
      const dir = path.join(trees, `wt-${++n}`);
      git(repo, "worktree", "add", "-q", "-b", branch, dir, "main");
      git(dir, "config", "user.email", "t@example.com");
      git(dir, "config", "user.name", "T");
      let head = git(dir, "rev-parse", "HEAD");
      for (const [file, text] of Object.entries(commits))
        head = commitFile(dir, file, text);
      if (Object.keys(commits).length) git(dir, "push", "-q", "origin", branch);
      return { dir, head };
    },
  };
}
