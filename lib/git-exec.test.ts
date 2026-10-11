import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentBranch,
  deleteBranch,
  git,
  GitError,
  gitOk,
  gitRebase,
  gitResult,
  gitSync,
  isAncestor,
  mergeBase,
  resolveRef,
  revParse,
  statusPorcelain,
  worktreeAdd,
  worktreeList,
  worktreeRemove,
} from "./git-exec";

// Test setup runs git directly; the code under test goes through the helper.
const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

const tmp = (prefix: string) =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

let repo: string;
const made: string[] = [];

function commit(file: string, text: string, message = file) {
  fs.writeFileSync(path.join(repo, file), text);
  sh(repo, "add", "--", file);
  sh(
    repo,
    "-c",
    "user.email=t@e",
    "-c",
    "user.name=T",
    "commit",
    "-qm",
    message
  );
  return sh(repo, "rev-parse", "HEAD");
}

beforeEach(() => {
  repo = tmp("aos-git-exec-");
  made.push(repo);
  sh(repo, "init", "-q", "-b", "main");
  commit("a.txt", "a\n");
});

afterEach(() => {
  for (const dir of made.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("environment", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never prompts, takes no optional locks and drops the server's tmux", async () => {
    process.env.TMUX = "/tmp/tmux-1/default,1,0";
    process.env.TMUX_PANE = "%1";
    process.env.GIT_TERMINAL_PROMPT = "1";
    // An alias starting with "!" runs in a shell with git's environment.
    const env = await git(repo, ["-c", "alias.envdump=!env", "envdump"]);
    const vars = Object.fromEntries(
      env
        .split("\n")
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
    );
    expect(vars.GIT_TERMINAL_PROMPT).toBe("0");
    expect(vars.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(vars.TMUX).toBeUndefined();
    expect(vars.TMUX_PANE).toBeUndefined();
    // The process's own environment is untouched.
    expect(process.env.TMUX).toBe("/tmp/tmux-1/default,1,0");
  });

  it("adds a call's own variables", async () => {
    const env = await git(repo, ["-c", "alias.envdump=!env", "envdump"], {
      env: { AOS_PROBE: "yes" },
    });
    expect(env).toMatch(/^AOS_PROBE=yes$/m);
  });

  it("feeds input on stdin, and closes it when there is none", async () => {
    const sha = (
      await git(repo, ["hash-object", "--stdin"], { input: "hi\n" })
    ).trim();
    expect(sha).toBe("45b983be36b73c0788dc9cbcb76cbb80fc7bb057");
    // Would wait forever on an open stdin.
    expect(
      (await git(repo, ["hash-object", "--stdin"], { timeout: 5000 })).trim()
    ).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("reads pathspecs literally when asked", async () => {
    expect((await git(repo, ["ls-files", "--", "*.txt"])).trim()).toBe("a.txt");
    expect(
      (
        await git(repo, ["ls-files", "--", "*.txt"], { literalPathspecs: true })
      ).trim()
    ).toBe("");
  });
});

describe("errors", () => {
  it("rejects with a GitError carrying the exit code, stderr and stdout", async () => {
    const error = await git(repo, ["rev-parse", "--verify", "nope"]).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(GitError);
    expect(error.exitCode).toBe(128);
    expect(error.code).toBe(128);
    expect(error.timedOut).toBe(false);
    expect(error.killed).toBe(false);
    expect(error.stderr).toMatch(/fatal/);
    expect(error.args).toEqual(["rev-parse", "--verify", "nope"]);
    expect(error.cwd).toBe(repo);
    expect(error.message).toMatch(/^git rev-parse failed: fatal/);
  });

  it("names the failure from stdout when stderr is empty", async () => {
    const error = await gitResult(repo, ["commit", "-m", "nothing"]).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(GitError);
    expect(error.exitCode).toBe(1);
    expect(error.message).toMatch(/^git commit failed: [\s\S]*nothing/);
  });

  it("gitOk and resolveRef swallow failures", async () => {
    expect(await gitOk(repo, ["rev-parse", "--verify", "nope"])).toBe(false);
    expect(await resolveRef(repo, "nope")).toBeNull();
    expect(await gitOk(path.join(repo, "missing"), ["status"])).toBe(false);
  });

  it("gitSync throws the same GitError", () => {
    expect(gitSync(repo, ["rev-parse", "HEAD"]).trim()).toMatch(
      /^[0-9a-f]{40}$/
    );
    let error: unknown;
    try {
      gitSync(repo, ["rev-parse", "--verify", "nope"]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GitError);
    expect((error as GitError).exitCode).toBe(128);
    expect((error as GitError).stderr).toMatch(/fatal/);
  });

  it("kills a hung git at its timeout", async () => {
    // Opening a FIFO with no writer blocks git itself, with no child to orphan.
    const fifo = path.join(repo, "hang");
    execFileSync("mkfifo", [fifo]);
    const started = Date.now();
    const error = await git(repo, ["hash-object", "--", fifo], {
      timeout: 300,
    }).catch((e) => e);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(error).toBeInstanceOf(GitError);
    expect(error.timedOut).toBe(true);
    expect(error.killed).toBe(true);
    expect(error.exitCode).toBeNull();
    expect(error.signal).toBe("SIGKILL");
    expect(error.message).toMatch(/^git hash-object timed out after/);
  });
});

describe("operations against a real repository", () => {
  it("reads refs, branches and status", async () => {
    const head = sh(repo, "rev-parse", "HEAD");
    expect(await revParse(repo, "HEAD")).toBe(head);
    expect(await resolveRef(repo, "main")).toBe(head);
    expect(await currentBranch(repo)).toBe("main");
    sh(repo, "checkout", "-q", "--detach");
    expect(await currentBranch(repo)).toBe("");
    fs.writeFileSync(path.join(repo, "b.txt"), "b");
    expect(await statusPorcelain(repo)).toBe("?? b.txt\n");
  });

  it("answers merge-base and ancestry", async () => {
    const base = sh(repo, "rev-parse", "HEAD");
    sh(repo, "checkout", "-qb", "feature");
    const tip = commit("f.txt", "f\n");
    sh(repo, "checkout", "-q", "main");
    commit("m.txt", "m\n");
    expect(await mergeBase(repo, "main", "feature")).toBe(base);
    expect(await isAncestor(repo, base, tip)).toBe(true);
    expect(await isAncestor(repo, tip, "main")).toBe(false);
    expect(await isAncestor(repo, "nope", "main")).toBe(false);
  });

  it("adds, lists and removes a worktree, then deletes its branch", async () => {
    const dir = path.join(tmp("aos-git-exec-wt-"), "wt");
    made.push(path.dirname(dir));
    await worktreeAdd(repo, ["-b", "feature/x", "--", dir, "main"]);
    const list = await worktreeList(repo);
    expect(list.map((w) => [w.path, w.branch])).toEqual([
      [repo, "main"],
      [dir, "feature/x"],
    ]);
    expect(list[1].head).toBe(sh(repo, "rev-parse", "HEAD"));

    // A changed worktree needs the force it's given.
    fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
    await expect(
      worktreeRemove(repo, dir, { force: 0 })
    ).rejects.toBeInstanceOf(GitError);
    await worktreeRemove(repo, dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(await worktreeList(repo)).toHaveLength(1);

    // An unmerged branch needs -D.
    sh(repo, "branch", "unmerged");
    sh(repo, "checkout", "-q", "unmerged");
    commit("u.txt", "u\n");
    sh(repo, "checkout", "-q", "main");
    await expect(deleteBranch(repo, "unmerged")).rejects.toThrow(
      /not fully merged/
    );
    await deleteBranch(repo, "unmerged", { force: true });
    await deleteBranch(repo, "feature/x");
    expect(sh(repo, "branch", "--format=%(refname:short)")).toBe("main");
  });

  it("rebases, and reports a conflict as a GitError the caller can abort", async () => {
    sh(repo, "checkout", "-qb", "feature");
    commit("f.txt", "f\n");
    sh(repo, "checkout", "-q", "main");
    commit("m.txt", "m\n");
    sh(repo, "checkout", "-q", "feature");
    const env = { GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@e" };
    await gitRebase(repo, ["main"], { env });
    expect(await isAncestor(repo, "main", "HEAD")).toBe(true);

    commit("a.txt", "feature\n");
    sh(repo, "checkout", "-q", "main");
    commit("a.txt", "main\n");
    sh(repo, "checkout", "-q", "feature");
    const error = await gitRebase(repo, ["main"], { env }).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error.exitCode).not.toBe(0);
    expect(`${error.stdout}${error.stderr}`).toMatch(/CONFLICT/);
    await gitRebase(repo, ["--abort"]);
    expect(await statusPorcelain(repo)).toBe("");
    expect(await currentBranch(repo)).toBe("feature");
  });

  it("reports a merge-tree conflict as exit code 1", async () => {
    sh(repo, "checkout", "-qb", "feature");
    commit("a.txt", "feature\n");
    sh(repo, "checkout", "-q", "main");
    commit("a.txt", "main\n");
    const error = await git(repo, [
      "merge-tree",
      "--write-tree",
      "main",
      "feature",
    ]).catch((e) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error.code).toBe(1);
  });
});
