import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/git/pr/route";
import { noteGhFailure, resetGhLimit } from "./tasks/gh-limit";
import { tempDir } from "@/lib/test-temp";

const PR = {
  number: 7,
  url: "https://github.com/o/r/pull/7",
  state: "OPEN",
  title: "T",
};

// A repository on a feature branch, and a stand-in gh that writes down each
// command it gets. By default it's logged in and lists one PR for the branch;
// `loggedOut` fails `auth status`, `rateLimited` fails `pr list` as GitHub
// does when the limit is spent.
function setup(opts: { loggedOut?: boolean; rateLimited?: boolean } = {}) {
  const dir = tempDir("aos-pr-route-");
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
require("fs").appendFileSync(${JSON.stringify(path.join(dir, "gh.log"))}, a + " " + b + "\\n");
if (a === "auth" && ${!!opts.loggedOut}) process.exit(1);
if (a === "pr" && b === "list") {
  if (${!!opts.rateLimited}) {
    console.error("API rate limit exceeded");
    process.exit(1);
  }
  console.log(${JSON.stringify(JSON.stringify([PR]))});
}
`,
    { mode: 0o755 }
  );
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  const log = path.join(dir, "gh.log");
  const asked = () =>
    fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
  return { repo, asked };
}

const post = (repo: string) =>
  POST(
    new NextRequest("http://x/api/git/pr", {
      method: "POST",
      body: JSON.stringify({ path: repo, title: "T" }),
    })
  );

const get = (repo: string) =>
  GET(new NextRequest(`http://x/api/git/pr?path=${encodeURIComponent(repo)}`));

describe("/api/git/pr", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetGhLimit();
  });

  it("reads the branch, its PR and its commits", async () => {
    const { repo } = setup();
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
    const { repo } = setup();
    await noteGhFailure(["pr", "list"], { stderr: "API rate limit exceeded" });
    const res = await get(repo);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/rate limit/);

    expect((await post(repo)).status).toBe(503);
  });

  it("says rate limit, not no PR, when the limit is hit at the PR lookup", async () => {
    const { repo } = setup({ rateLimited: true });
    const res = await get(repo);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/rate limit/);
  });

  it("refuses without a gh login, and asks gh nothing more", async () => {
    const { repo, asked } = setup({ loggedOut: true });
    for (const res of [await get(repo), await post(repo)]) {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(
        /not installed or not authenticated/
      );
    }
    expect(asked()).toEqual(["auth status", "auth status"]);
  });
});
