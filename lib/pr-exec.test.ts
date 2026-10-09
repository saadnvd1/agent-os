import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  getBaseBranch,
  getCommitsSinceBase,
  getPRForBranch,
  remoteDefaultBranch,
} from "./pr";
import { getDefaultBranch } from "./git-status";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

// A cloned repository picks its own branch names, and git allows shell
// syntax in them: they must reach git and gh as arguments, never as shell.
describe("PR reads with names a repository chose", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-pr-"));
  const marker = path.join(dir, "ran");
  const hostile = `x$(touch${"${IFS}"}${marker})`;
  git(dir, "init", "-q", "-b", "main");
  const commit = (m: string) =>
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
      m
    );
  commit("base");
  git(dir, "update-ref", `refs/remotes/origin/${hostile}`, "HEAD");
  git(
    dir,
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    `refs/remotes/origin/${hostile}`
  );
  commit("feature work");

  it("reads the remote default branch literally", () => {
    expect(remoteDefaultBranch(dir)).toBe(hostile);
    expect(getBaseBranch(dir)).toBe(hostile);
    expect(getDefaultBranch(dir)).toBe(hostile);
  });

  it("lists commits since it without running anything", () => {
    const commits = getCommitsSinceBase(dir, `origin/${hostile}`);
    expect(commits.map((c) => c.subject)).toEqual(["feature work"]);
    expect(getCommitsSinceBase(dir, hostile)).toEqual([]);
    getPRForBranch(dir, hostile);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("falls back to main with no remote default", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "aos-pr-"));
    git(plain, "init", "-q", "-b", "main");
    expect(remoteDefaultBranch(plain)).toBe("main");
  });
});
