import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ATTRIBUTION_ERE, installWorktreeHooks } from "./worktree-hooks";
import { ATTRIBUTION } from "./tasks/code-review";

let root: string;
let repo: string;
let tree: string;
const realHome = process.env.HOME;
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });

// A project hook that leaves a mark, so a test can tell it ran.
function projectHook(dir: string, name: string, body: string) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

const MESSAGE = `feat: a change

Why it changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
🤖 Generated with [Claude Code](https://claude.com/claude-code)
Co-authored-by: Ada <ada@example.com>
`;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-hooks-")));
  repo = path.join(root, "repo");
  tree = path.join(root, "tree");
  fs.mkdirSync(repo);
  run(repo, "init", "-q", "-b", "main");
  run(repo, "config", "user.email", "t@example.com");
  run(repo, "config", "user.name", "t");
  run(repo, "config", "commit.gpgsign", "false");
  run(repo, "commit", "-q", "--allow-empty", "-m", "first");
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(root, { recursive: true, force: true });
});

// `git commit -F -` reads the message from stdin.
function commitWith(cwd: string, message: string): string {
  fs.writeFileSync(path.join(cwd, `f${Math.random()}`), "x");
  run(cwd, "add", "-A");
  execFileSync("git", ["commit", "-q", "-F", "-"], {
    cwd,
    input: message,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return run(cwd, "log", "-1", "--format=%B");
}

describe("installWorktreeHooks", () => {
  it("strips attribution in the worktree, keeps the rest, and still runs the project's hooks", async () => {
    // Husky-style: a relative hooksPath in the shared repository config.
    const marks = path.join(root, "marks");
    projectHook(
      path.join(repo, ".hooks"),
      "pre-commit",
      `echo pre-commit >> '${marks}'`
    );
    projectHook(
      path.join(repo, ".hooks"),
      "commit-msg",
      `echo commit-msg >> '${marks}'; cat "$1" > '${root}/seen'`
    );
    run(repo, "add", ".hooks");
    run(repo, "commit", "-q", "--no-verify", "-m", "hooks");
    run(repo, "config", "core.hooksPath", ".hooks");
    run(repo, "worktree", "add", "-q", "-b", "feature", tree);

    await installWorktreeHooks(tree);

    const body = commitWith(tree, MESSAGE);
    expect(body).not.toMatch(/claude/i);
    expect(body).toContain("feat: a change\n\nWhy it changed.\n\n");
    expect(body).toContain("Co-authored-by: Ada <ada@example.com>");
    expect(fs.readFileSync(marks, "utf-8")).toBe("pre-commit\ncommit-msg\n");
    // The project's commit-msg hook sees the message already stripped.
    expect(fs.readFileSync(path.join(root, "seen"), "utf-8")).not.toMatch(
      /claude/i
    );
  });

  it("leaves the main checkout and its hooks alone", async () => {
    const marks = path.join(root, "marks");
    projectHook(
      path.join(repo, ".hooks"),
      "pre-commit",
      `echo main >> '${marks}'`
    );
    run(repo, "add", ".hooks");
    run(repo, "commit", "-q", "--no-verify", "-m", "hooks");
    run(repo, "config", "core.hooksPath", ".hooks");
    run(repo, "worktree", "add", "-q", "-b", "feature", tree);

    const dir = await installWorktreeHooks(tree);

    expect(run(repo, "config", "core.hooksPath").trim()).toBe(".hooks");
    expect(run(tree, "config", "core.hooksPath").trim()).toBe(dir);
    expect(commitWith(repo, MESSAGE)).toContain("Co-Authored-By: Claude");
    expect(fs.readFileSync(marks, "utf-8")).toBe("main\n");
  });

  it("runs hooks from the repository's own hooks folder when no hooksPath is set", async () => {
    const marks = path.join(root, "marks");
    run(repo, "worktree", "add", "-q", "-b", "feature", tree);
    projectHook(
      path.join(repo, ".git", "hooks"),
      "pre-commit",
      `echo default >> '${marks}'`
    );

    await installWorktreeHooks(tree);
    // Twice is the same as once.
    await installWorktreeHooks(tree);

    expect(commitWith(tree, MESSAGE)).not.toMatch(/claude/i);
    expect(fs.readFileSync(marks, "utf-8")).toBe("default\n");
  });

  it("a failing project hook still fails the commit", async () => {
    const marks = path.join(root, "marks");
    projectHook(
      path.join(repo, ".git", "hooks"),
      "pre-commit",
      `echo refused >> '${marks}'; echo 'project says no' >&2; exit 1`
    );
    run(repo, "worktree", "add", "-q", "-b", "feature", tree);
    await installWorktreeHooks(tree);
    const before = run(tree, "rev-list", "--count", "HEAD");
    expect(() => commitWith(tree, "feat: x\n")).toThrow(/project says no/);
    expect(fs.readFileSync(marks, "utf-8")).toBe("refused\n");
    expect(run(tree, "rev-list", "--count", "HEAD")).toBe(before);
  });

  it("is installed by createWorktree", async () => {
    process.env.HOME = path.join(root, "home");
    fs.mkdirSync(process.env.HOME);
    vi.resetModules();
    const { createWorktree } = await import("./worktrees");
    const wt = await createWorktree({ projectPath: repo, featureName: "x" });
    expect(run(wt.worktreePath, "config", "core.hooksPath").trim()).toMatch(
      /agentos-hooks$/
    );
    expect(commitWith(wt.worktreePath, MESSAGE)).not.toMatch(/claude/i);
  });
});

describe("the attribution rule", () => {
  const lines: [string, boolean][] = [
    ["Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", true],
    ["co-authored-by: Claude <claude@anthropic.com>", true],
    ["Co-Authored-By: Someone <x@anthropic.com>", true],
    ["  Co-Authored-By: Claude", true],
    ["Claude-Session: https://claude.ai/code/abc", true],
    ["🤖 Generated with [Claude Code](https://claude.com/claude-code)", true],
    ["Generated with [Claude Code](https://claude.com/claude-code)", true],
    ["_Generated with Claude Code_", true],
    ["🤖 Generated with Codex", true],
    ["  Claude-Session: x", true],
    ["Co-authored-by: Ada <ada@example.com>", false],
    ["Use Claude to review the diff", false],
    ["feat(agents): launch Claude with flags", false],
    ["Generated with a script", false],
  ];

  it("matches the same lines in the commit-msg hook and the PR body check", () => {
    for (const [line, attribution] of lines) {
      const grep = spawnSync("grep", ["-qiE", ATTRIBUTION_ERE], {
        input: line + "\n",
      });
      expect(grep.status === 0, `grep: ${line}`).toBe(attribution);
      expect(ATTRIBUTION.test(line.trimStart()), `regex: ${line}`).toBe(
        attribution
      );
    }
  });
});
