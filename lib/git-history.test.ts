import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";
import {
  getCommitDetail,
  getCommitFileDiff,
  getCommitHistory,
  isCommitHash,
} from "./git-history";
import { GET as detailRoute } from "@/app/api/git/history/[hash]/route";
import { GET as diffRoute } from "@/app/api/git/history/[hash]/diff/route";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-history-"));
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
git("init", "-q", "-b", "main");
fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
git("add", ".");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first");
const head = git("rev-parse", "HEAD");
const marker = path.join(dir, "ran");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("isCommitHash", () => {
  it("takes 7 to 40 lowercase hex digits only", () => {
    expect(isCommitHash(head)).toBe(true);
    expect(isCommitHash(head.slice(0, 7))).toBe(true);
    for (const bad of [
      "abc12",
      "-p",
      "--output=x",
      "HEAD",
      `${head}x`,
      "$(id)",
      "ABCDEF1",
    ])
      expect(isCommitHash(bad), bad).toBe(false);
  });
});

describe("commit history reads", () => {
  it("still read a real commit", () => {
    expect(getCommitHistory(dir, 5).map((c) => c.hash)).toEqual([head]);
    expect(getCommitDetail(dir, head)?.files.map((f) => f.path)).toEqual([
      "a.txt",
    ]);
    expect(getCommitFileDiff(dir, head, "a.txt")).toContain("+hello");
  });

  it("never run what they're given as a command or an option", () => {
    expect(getCommitDetail(dir, `--output=${marker}`)).toBeNull();
    expect(getCommitDetail(dir, `$(touch ${marker})`)).toBeNull();
    // A path that matches nothing: no diff (some git versions still
    // print the commit header), and nothing run.
    expect(getCommitFileDiff(dir, head, `"; touch ${marker}; "`)).not.toContain(
      "diff --git"
    );
    // A path that matches nothing: no diff (some git versions still
    // print the commit header), and nothing run.
    expect(getCommitFileDiff(dir, head, `$(touch ${marker})`)).not.toContain(
      "diff --git"
    );
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("routes answer 400 for a hash that isn't one", async () => {
    const q = `path=${encodeURIComponent(dir)}&file=a.txt`;
    for (const hash of ["--output=x", "$(id)", "HEAD"]) {
      const params = { params: Promise.resolve({ hash }) };
      const url = `http://x/api/git/history/x?${q}`;
      expect((await detailRoute(new NextRequest(url), params)).status).toBe(
        400
      );
      expect((await diffRoute(new NextRequest(url), params)).status).toBe(400);
    }
    const ok = { params: Promise.resolve({ hash: head }) };
    const url = `http://x/api/git/history/x?${q}`;
    expect((await detailRoute(new NextRequest(url), ok)).status).toBe(200);
  });
});
