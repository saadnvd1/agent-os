import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import {
  branchExists,
  getBranches,
  getDefaultBranch,
  getGitStatus,
  remoteBranchExists,
} from "./git";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

describe("getDefaultBranch", () => {
  it("ignores a remote default branch that isn't a plain branch name", async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "aos-git-"));
    git(dir, "init", "-q", "-b", "main");
    git(
      dir,
      "-c",
      "user.email=t@e",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x"
    );
    // What a hostile remote's HEAD can leave behind after a clone.
    git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/x$(id)"
    );
    expect(await getDefaultBranch(dir)).toBe("main");
  });

  const repo = (branch: string) => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "aos-git-"));
    git(dir, "init", "-q", "-b", branch);
    git(
      dir,
      "-c",
      "user.email=t@e",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x"
    );
    return dir;
  };

  it("takes the remote's default branch, without its refs/remotes prefix", async () => {
    const dir = repo("main");
    git(dir, "update-ref", "refs/remotes/origin/develop", "HEAD");
    git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/develop"
    );
    expect(await getDefaultBranch(dir)).toBe("develop");
  });

  it("falls back to master when there is no remote default or main", async () => {
    expect(await getDefaultBranch(repo("master"))).toBe("master");
  });
});

describe("git reads run without a shell", () => {
  const repo = () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "aos-git-"));
    git(dir, "init", "-q", "-b", "main");
    git(
      dir,
      "-c",
      "user.email=t@e",
      "-c",
      "user.name=T",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x"
    );
    return dir;
  };

  it("lists branches", async () => {
    const dir = repo();
    git(dir, "branch", "feature/a");
    expect((await getBranches(dir)).sort()).toEqual(["feature/a", "main"]);
  });

  it("checks a branch exists, taking odd names literally", async () => {
    const dir = repo();
    const marker = path.join(dir, "pwned");
    expect(await branchExists(dir, "main")).toBe(true);
    expect(await branchExists(dir, "nope")).toBe(false);
    expect(await branchExists(dir, "--help")).toBe(false);
    expect(await branchExists(dir, `$(touch ${marker})`)).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("checks a branch on the remote", async () => {
    const origin = fs.mkdtempSync(path.join(tmpdir(), "aos-origin-"));
    git(origin, "init", "-q", "--bare");
    const dir = repo();
    git(dir, "remote", "add", "origin", origin);
    git(dir, "push", "-q", "origin", "main");
    expect(await remoteBranchExists(dir, "main")).toBe(true);
    expect(await remoteBranchExists(dir, "other")).toBe(false);
    expect(await remoteBranchExists(dir, "--upload-pack=x")).toBe(false);
  });

  it("counts changes, with no upstream as level", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "new.txt"), "x");
    expect(await getGitStatus(dir)).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 1,
      ahead: 0,
      behind: 0,
    });
  });
});
