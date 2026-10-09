import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  createPR,
  getBaseBranch,
  getCommitsSinceBase,
  getPRForBranch,
  remoteDefaultBranch,
} from "./pr";
import { getDefaultBranch } from "./git-status";
import { generatePRContent } from "./pr-generation";

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

describe("createPR", () => {
  it("passes the title, base and body to gh as single arguments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-pr-create-"));
    const bin = path.join(dir, "bin");
    const record = path.join(dir, "gh-args.json");
    const marker = path.join(dir, "ran");
    fs.mkdirSync(bin);
    // A stand-in gh: writes down its arguments and prints a PR URL.
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));
console.log("https://github.com/o/r/pull/7");
`,
      { mode: 0o755 }
    );
    git(dir, "init", "-q", "-b", "main");
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    try {
      const title = `x"; touch ${marker}; "`;
      const body = `it's $(touch ${marker})`;
      const pr = createPR(dir, "-x", "main", title, body);
      expect(pr).toMatchObject({
        number: 7,
        url: "https://github.com/o/r/pull/7",
      });
      expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual([
        "pr",
        "create",
        "--title",
        title,
        "--base",
        "main",
        "--body",
        body,
      ]);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("generatePRContent", () => {
  it("never runs a branch name or commit subject, and sends the prompt on stdin", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-pr-gen-"));
    const bin = path.join(dir, "bin");
    const record = path.join(dir, "claude.json");
    const marker = path.join(dir, "ran");
    fs.mkdirSync(bin);
    // A stand-in claude: writes down its arguments and stdin, answers JSON.
    fs.writeFileSync(
      path.join(bin, "claude"),
      `#!/usr/bin/env node
const fs = require("fs");
if (process.argv[2] === "--version") { console.log("1.0"); process.exit(0); }
const input = fs.readFileSync(0, "utf8");
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), input }));
console.log(JSON.stringify({ title: "T", description: "D" }));
`,
      { mode: 0o755 }
    );
    const hostile = `x$(touch${"${IFS}"}${marker})`;
    git(dir, "init", "-q", "-b", hostile);
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
    git(dir, "switch", "-q", "-c", "feature");
    commit(`add $(touch ${marker}) and \`touch ${marker}\``);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    try {
      const out = await generatePRContent(dir, hostile);
      expect(out).toEqual({ title: "T", description: "D" });
      const seen = JSON.parse(fs.readFileSync(record, "utf8"));
      expect(seen.args).toEqual(["--print"]);
      expect(seen.input).toContain(`<untrusted source="commit subjects">`);
      expect(seen.input).toContain(`add $(touch ${marker})`);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
