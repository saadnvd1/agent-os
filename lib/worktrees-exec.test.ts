import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { deleteWorktree, listWorktrees, mainCheckoutOf } from "./worktrees";

// Worktree paths and branch names come from session rows: git gets them as
// arguments, so shell syntax in either is only ever a name.
let root: string;
let repo: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: "pipe" });

beforeEach(() => {
  // realpath: macOS's /var is /private/var, and git reports the real one.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-exec-")));
  repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("commit", "-q", "--allow-empty", "-m", "first");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("worktrees with shell syntax in their path and branch", () => {
  const branch = "x;touch${IFS}pwned`id`";
  const dir = () => path.join(root, `wt "$(touch pwned)" \`id\``);

  it("finds the main checkout, lists, and deletes the worktree and its branch, running nothing", async () => {
    git("worktree", "add", "-q", "-b", branch, dir());

    expect(await mainCheckoutOf(dir())).toBe(repo);
    expect(await listWorktrees(repo)).toContainEqual(
      expect.objectContaining({ path: dir(), branch })
    );

    await deleteWorktree(dir(), repo, true);

    expect(fs.existsSync(dir())).toBe(false);
    expect(git("branch", "--list", branch).trim()).toBe("");
    for (const where of [root, repo, process.cwd()])
      expect(fs.existsSync(path.join(where, "pwned"))).toBe(false);
  });

  it("answers no main checkout for a path that isn't a repository", async () => {
    expect(await mainCheckoutOf(path.join(root, "$(touch pwned)"))).toBe("");
    expect(fs.existsSync(path.join(process.cwd(), "pwned"))).toBe(false);
  });
});
