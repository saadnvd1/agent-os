import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/git/pr/route";
import { noteGhFailure, resetGhLimit } from "./tasks/gh-limit";

const PR = {
  number: 7,
  url: "https://github.com/o/r/pull/7",
  state: "OPEN",
  title: "T",
};

// A repository on a feature branch, and a stand-in gh that is logged in and
// lists one PR for it.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-pr-route-"));
  const repo = path.join(dir, "repo");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  const commit = (m: string) =>
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      m
    );
  git("init", "-q", "-b", "main");
  commit("base");
  git("switch", "-q", "-c", "feature");
  commit("feature work");
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env node
const [a, b] = process.argv.slice(2);
if (a === "pr" && b === "list") console.log(${JSON.stringify(JSON.stringify([PR]))});
`,
    { mode: 0o755 }
  );
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  return repo;
}

const get = (repo: string) =>
  GET(new NextRequest(`http://x/api/git/pr?path=${encodeURIComponent(repo)}`));

describe("/api/git/pr", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetGhLimit();
  });

  it("reads the branch, its PR and its commits", async () => {
    const repo = setup();
    const res = await get(repo);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      branch: "feature",
      baseBranch: "main",
      existingPR: PR,
      commits: [{ subject: "feature work" }],
    });
  });

  it("says GitHub's rate limit, not a missing login or PR, while gh is backed off", async () => {
    const repo = setup();
    await noteGhFailure(["pr", "list"], { stderr: "API rate limit exceeded" });
    const res = await get(repo);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/rate limit/);

    const created = await POST(
      new NextRequest("http://x/api/git/pr", {
        method: "POST",
        body: JSON.stringify({ path: repo, title: "T" }),
      })
    );
    expect(created.status).toBe(503);
  });
});
