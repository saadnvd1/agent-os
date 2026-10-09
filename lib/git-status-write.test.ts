import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  commit,
  createBranch,
  hasUpstream,
  isValidBranchName,
  push,
} from "./git-status";

// The commit, branch and push the git panel's POST routes run: whatever a
// request puts in a message or a branch name is data, never shell or options.
let root: string;
let repo: string;
let origin: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: "pipe" });
// Anything the payloads below would create if a shell ran them.
const marker = () => path.join(root, "pwned");
const pwned = () =>
  fs.existsSync(marker()) ||
  fs.existsSync(path.join(repo, "pwned")) ||
  fs.existsSync(path.join(repo, "x"));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "git-status-write-"));
  repo = path.join(root, "repo");
  origin = path.join(root, "origin.git");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", origin);
  fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "first");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const stage = (name = "b.txt") => {
  fs.writeFileSync(path.join(repo, name), `${Math.random()}\n`);
  git("add", name);
};

describe("commit", () => {
  it.each([
    `x; touch ${path.join("ROOT", "pwned")}`,
    `$(touch ROOT/pwned)`,
    "`touch ROOT/pwned`",
    `"; touch ROOT/pwned; "`,
    "--amend",
    "--output=x",
    "-m",
    "line one\n\nline two with 'quotes' and \"doubles\"",
  ])("records %j as the message, verbatim, running nothing", async (raw) => {
    const message = raw.replaceAll("ROOT", root);
    stage();
    await commit(repo, message);
    expect(git("log", "-1", "--format=%B").replace(/\n+$/, "")).toBe(message);
    // A new commit, not an amended one.
    expect(git("rev-list", "--count", "HEAD").trim()).toBe("2");
    expect(pwned()).toBe(false);
  });

  it("fails, without crashing, when git exits before reading a long message", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"));
    try {
      await expect(commit(outside, "m".repeat(4 << 20))).rejects.toThrow(
        /git commit failed: .*not a git repository/i
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("fails when nothing is staged", async () => {
    await expect(commit(repo, "empty")).rejects.toThrow(/git commit failed/);
  });
});

describe("createBranch", () => {
  it.each([
    "x; touch /tmp/pwned",
    "-f",
    "--orphan=x",
    "-",
    "",
    "a..b",
    "a b",
    "a~1",
    "x.lock",
  ])("refuses %j and leaves the branch alone", (name) => {
    expect(isValidBranchName(repo, name)).toBe(false);
    expect(() => createBranch(repo, name)).toThrow(/Invalid branch name/);
    expect(git("branch", "--show-current").trim()).toBe("main");
    expect(git("branch", "--format=%(refname:short)").trim()).toBe("main");
  });

  it("creates and switches to a name with shell syntax in it, as a name", () => {
    const name = "x;touch${IFS}pwned$(id)";
    expect(isValidBranchName(repo, name)).toBe(true);
    createBranch(repo, name);
    expect(git("branch", "--show-current").trim()).toBe(name);
    expect(pwned()).toBe(false);
  });

  it("names a branch that shares a file's name as the branch", () => {
    createBranch(repo, "a.txt");
    expect(git("branch", "--show-current").trim()).toBe("a.txt");
  });
});

describe("push", () => {
  it("sets the upstream for a branch whose name is shell syntax, running nothing", async () => {
    const name = "x;touch${IFS}pwned`id`";
    createBranch(repo, name);
    stage();
    await commit(repo, "work");
    expect(hasUpstream(repo)).toBe(false);
    await push(repo, true);
    expect(hasUpstream(repo)).toBe(true);
    expect(
      execFileSync("git", ["ls-remote", "--heads", origin], {
        encoding: "utf-8",
      })
    ).toContain(`refs/heads/${name}`);
    expect(pwned()).toBe(false);
  });

  it("pushes to the upstream it already has", async () => {
    await push(repo, true);
    stage();
    await commit(repo, "second");
    await push(repo);
    expect(
      execFileSync("git", ["rev-parse", "main"], {
        cwd: origin,
        encoding: "utf-8",
      })
    ).toBe(git("rev-parse", "HEAD"));
  });

  it("refuses to set an upstream from a detached HEAD", async () => {
    git("checkout", "-q", "--detach");
    await expect(push(repo, true)).rejects.toThrow(/detached HEAD/);
  });

  it("fails with git's own reason", async () => {
    git("remote", "set-url", "origin", path.join(root, "missing.git"));
    await expect(push(repo, true)).rejects.toThrow(
      /git push failed: [\s\S]*(missing\.git|does not appear)/
    );
  });
});
