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
});
