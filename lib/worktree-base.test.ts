import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { tempDir } from "@/lib/test-temp";

// A bare origin, a clone made before a branch was pushed to it, and a second
// clone that does the pushing.
let root: string;
let origin: string;
let clone: string;
let pusher: string;
const realHome = process.env.HOME;
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
const configure = (dir: string) => {
  run(dir, "config", "user.email", "t@example.com");
  run(dir, "config", "user.name", "t");
  run(dir, "config", "commit.gpgsign", "false");
};

async function load() {
  vi.resetModules();
  return import("./worktrees");
}

beforeEach(() => {
  root = fs.realpathSync(tempDir("wt-base-"));
  fs.mkdirSync(path.join(root, "home"));
  process.env.HOME = path.join(root, "home");
  origin = path.join(root, "origin.git");
  run(root, "init", "-q", "--bare", "-b", "main", origin);
  pusher = path.join(root, "pusher");
  run(root, "clone", "-q", origin, pusher);
  configure(pusher);
  run(pusher, "commit", "-q", "--allow-empty", "-m", "first");
  run(pusher, "push", "-q", "origin", "main");
  clone = path.join(root, "clone");
  run(root, "clone", "-q", origin, clone);
  configure(clone);
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(root, { recursive: true, force: true });
});

const pushBranch = (name: string) => {
  run(pusher, "checkout", "-q", "-b", name);
  run(pusher, "commit", "-q", "--allow-empty", "-m", `on ${name}`);
  run(pusher, "push", "-q", "origin", name);
  return run(pusher, "rev-parse", "HEAD");
};

describe("createWorktree fetches its base", () => {
  it("cuts from origin's branch that the clone never fetched", async () => {
    const tip = pushBranch("feature/chat-integrations");
    expect(() =>
      run(clone, "rev-parse", "--verify", "origin/feature/chat-integrations")
    ).toThrow();
    const { createWorktree } = await load();
    const made = await createWorktree({
      projectPath: clone,
      featureName: "needs base",
      baseBranch: "feature/chat-integrations",
    });
    expect(run(made.worktreePath, "rev-parse", "HEAD")).toBe(tip);
    expect(run(clone, "rev-parse", "origin/feature/chat-integrations")).toBe(
      tip
    );
  });

  it("cuts from origin's newer tip, not the clone's stale main", async () => {
    run(pusher, "checkout", "-q", "main");
    run(pusher, "commit", "-q", "--allow-empty", "-m", "newer");
    run(pusher, "push", "-q", "origin", "main");
    const tip = run(pusher, "rev-parse", "HEAD");
    const { createWorktree } = await load();
    const made = await createWorktree({
      projectPath: clone,
      featureName: "fresh",
    });
    expect(run(made.worktreePath, "rev-parse", "HEAD")).toBe(tip);
  });

  it("falls back to a local branch when origin can't be reached", async () => {
    run(clone, "branch", "feature/local-only", "main");
    run(clone, "remote", "set-url", "origin", path.join(root, "gone.git"));
    const { createWorktree } = await load();
    const made = await createWorktree({
      projectPath: clone,
      featureName: "offline",
      baseBranch: "feature/local-only",
    });
    expect(fs.existsSync(made.worktreePath)).toBe(true);
  });

  it("fails a required fetch instead of falling back", async () => {
    run(clone, "remote", "set-url", "origin", path.join(root, "gone.git"));
    const { createWorktree } = await load();
    await expect(
      createWorktree({
        projectPath: clone,
        featureName: "strict",
        fetch: "required",
      })
    ).rejects.toThrow(/^Fetching main failed: /);
  });

  it("says the base isn't anywhere, and leaves nothing behind", async () => {
    const { createWorktree } = await load();
    const { isBaseUnresolvable } = await import("./worktree-base");
    const err = await createWorktree({
      projectPath: clone,
      featureName: "nowhere",
      baseBranch: "feature/nope",
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isBaseUnresolvable((err as Error).message)).toBe(true);
    expect(run(clone, "branch", "--format=%(refname:short)")).toBe("main");
    expect(run(clone, "worktree", "list", "--porcelain")).not.toContain(
      "nowhere"
    );
  });

  it("still works in a repo with no origin", async () => {
    const solo = path.join(root, "solo");
    fs.mkdirSync(solo);
    run(solo, "init", "-q", "-b", "main");
    configure(solo);
    run(solo, "commit", "-q", "--allow-empty", "-m", "first");
    const { createWorktree } = await load();
    const made = await createWorktree({
      projectPath: solo,
      featureName: "solo",
    });
    expect(fs.existsSync(made.worktreePath)).toBe(true);
  });
});
