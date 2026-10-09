import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import { getDefaultBranch } from "./git";

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
