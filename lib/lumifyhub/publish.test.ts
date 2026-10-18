import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Project } from "../db";
import { isWithin, resolveRepoFile } from "./publish";
import { tempDir } from "@/lib/test-temp";

let repo: string;
let outside: string;
let project: Project;

beforeAll(() => {
  const base = fs.realpathSync(tempDir("pub-"));
  repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  outside = path.join(base, "secret.md");
  fs.writeFileSync(outside, "# secret");
  fs.writeFileSync(path.join(repo, "..foo.md"), "# fine");
  fs.symlinkSync(outside, path.join(repo, "leak.md"));
  project = { working_directory: repo } as Project;
});

describe("resolveRepoFile", () => {
  it("refuses a symlink that points outside the project", async () => {
    await expect(
      resolveRepoFile(project, path.join(repo, "leak.md"))
    ).rejects.toThrow(/isn't in this project/);
  });

  it("allows a file whose name starts with two dots", async () => {
    const { repoPath } = await resolveRepoFile(
      project,
      path.join(repo, "..foo.md")
    );
    expect(repoPath).toBe("..foo.md");
  });

  it("refuses a directory", async () => {
    fs.mkdirSync(path.join(repo, "dir.md"), { recursive: true });
    await expect(
      resolveRepoFile(project, path.join(repo, "dir.md"))
    ).rejects.toThrow();
  });
});

describe("isWithin", () => {
  it("rejects the root itself and its parent", () => {
    expect(isWithin("/a/b", "/a/b")).toBe(false);
    expect(isWithin("/a/b", "/a/c.md")).toBe(false);
    expect(isWithin("/a/b", "/a/b/..x.md")).toBe(true);
  });
});
