import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// A failed `git worktree add` can still have made its branch and part of
// the worktree. createWorktree must leave neither behind, and say what
// really went wrong rather than the "already exists" of the next try.
let root: string;
let repo: string;
let home: string;
const realHome = process.env.HOME;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: "pipe" });

function hook(body: string) {
  const file = path.join(repo, ".git", "hooks", "post-checkout");
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

// WORKTREES_DIR is read from the home directory when the module loads.
async function load() {
  vi.resetModules();
  return import("./worktrees");
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-add-")));
  repo = path.join(root, "repo");
  home = path.join(root, "home");
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  process.env.HOME = home;
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("commit", "-q", "--allow-empty", "-m", "first");
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(root, { recursive: true, force: true });
});

const branches = () =>
  git("branch", "--format=%(refname:short)").trim().split("\n");

describe("createWorktree when an add fails partway", () => {
  it("leaves no branch or worktree and reports the first real error", async () => {
    const { createWorktree, worktreePathFor } = await load();
    hook("echo 'checkout hook broke' >&2; exit 1");

    await expect(
      createWorktree({ projectPath: repo, featureName: "broken hook" })
    ).rejects.toThrow(/checkout hook broke/);

    expect(branches()).toEqual(["main"]);
    expect(fs.existsSync(worktreePathFor(repo, "broken hook"))).toBe(false);
    expect(git("worktree", "list", "--porcelain")).not.toContain("broken");
    const admin = path.join(repo, ".git", "worktrees");
    expect(fs.existsSync(admin) ? fs.readdirSync(admin) : []).toEqual([]);
  });

  it("stops at a timeout, says so, and cleans up", async () => {
    const { createWorktree } = await load();
    const tries = path.join(root, "tries");
    hook(`echo try >> '${tries}'; sleep 3`);

    await expect(
      createWorktree({
        projectPath: repo,
        featureName: "slow disk",
        timeoutMs: 500,
      })
    ).rejects.toThrow(/timed out after/);
    // At most one try, not one per ref (a slow add may not reach the hook).
    const ran = fs.existsSync(tries) ? fs.readFileSync(tries, "utf-8") : "";
    expect(ran).toMatch(/^(try\n)?$/);
    expect(branches()).toEqual(["main"]);
  });

  it("never touches a path another start already holds", async () => {
    const { createWorktree, worktreePathFor } = await load();
    const taken = worktreePathFor(repo, "raced");
    fs.mkdirSync(taken, { recursive: true });
    fs.writeFileSync(path.join(taken, "theirs.txt"), "x\n");

    await expect(
      createWorktree({ projectPath: repo, featureName: "raced" })
    ).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(taken, "theirs.txt"), "utf-8")).toBe(
      "x\n"
    );
  });

  it("never deletes a branch made between its check and its add", async () => {
    // The race: the early branchExists check passed, then the branch
    // appeared before the add, at the same start point.
    vi.doMock("./git", async (orig) => ({
      ...(await orig<typeof import("./git")>()),
      branchExists: async () => false,
    }));
    const { createWorktree } = await load();
    vi.doUnmock("./git");
    git("branch", "feature/taken", "main");
    const tip = git("rev-parse", "main").trim();

    await expect(
      createWorktree({ projectPath: repo, featureName: "taken" })
    ).rejects.toThrow(/already exists/);
    expect(git("rev-parse", "feature/taken").trim()).toBe(tip);
  });

  it("keeps a branch that has moved past its start point", async () => {
    const { createWorktree } = await load();
    // The hook commits on the new branch, then fails the add.
    hook(
      "git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m mine; exit 1"
    );

    await expect(
      createWorktree({ projectPath: repo, featureName: "has work" })
    ).rejects.toThrow();
    expect(branches()).toContain("feature/has-work");
  });

  it("still falls back past a ref that doesn't exist", async () => {
    const { createWorktree } = await load();
    const made = await createWorktree({ projectPath: repo, featureName: "ok" });
    expect(fs.existsSync(made.worktreePath)).toBe(true);
    expect(branches()).toContain(made.branchName);
  });
});

describe("worktreeAddTimeout", () => {
  it("is two minutes, scaled by load past the cores, capped at ten", async () => {
    const { worktreeAddTimeout } = await load();
    expect(worktreeAddTimeout(1, 8)).toBe(120_000);
    expect(worktreeAddTimeout(16, 8)).toBe(240_000);
    expect(worktreeAddTimeout(120, 8)).toBe(600_000);
  });

  it("reports the first error that isn't a missing ref", async () => {
    const { firstRealError } = await load();
    const errs = [
      new Error("fatal: invalid reference: origin/main"),
      new Error("git worktree add timed out after 120s"),
      new Error("fatal: a branch named 'x' already exists"),
    ];
    expect(firstRealError(errs).message).toMatch(/timed out/);
    expect(firstRealError(errs.slice(0, 1)).message).toMatch(/invalid/);
  });
});
