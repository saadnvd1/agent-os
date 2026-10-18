import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUN_PREFIX,
  leaks,
  snapshot,
  sweepStale,
  testTmpPrefixes,
  worktreeLeaks,
} from "./vitest.tmp";
import { tempDir } from "@/lib/test-temp";

const old = (path: string) => {
  const t = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  utimesSync(path, t, t);
};
const entry = (dir: string, name: string, aged = false) => {
  const p = join(dir, name);
  mkdirSync(p);
  writeFileSync(join(p, "machine.key"), "k");
  if (aged) old(p);
  return p;
};

describe("sweepStale", () => {
  it("removes old leftovers of the suite and nothing else", () => {
    const dir = tempDir("sweep-");
    const oldRun = entry(dir, `${RUN_PREFIX}abc`, true);
    const oldLink = entry(dir, "agentos-link-abc", true);
    const freshLink = entry(dir, "agentos-link-def");
    const otherOld = entry(dir, "unrelated-abc", true);
    const dbOld = entry(dir, "agentos-db-abc", true);
    expect(sweepStale(dir)).toEqual({ removed: 2, failed: 0 });
    expect(existsSync(oldRun)).toBe(false);
    expect(existsSync(oldLink)).toBe(false);
    expect(existsSync(freshLink)).toBe(true);
    expect(existsSync(otherOld)).toBe(true);
    expect(existsSync(dbOld)).toBe(true);
  });
});

describe("sweepStale limit", () => {
  it("stops after the limit and takes the rest next time", () => {
    const dir = tempDir("sweep-");
    for (const n of ["a", "b", "c"]) entry(dir, `aos-config-${n}`, true);
    expect(sweepStale(dir, { limit: 2 }).removed).toBe(2);
    expect(sweepStale(dir, { limit: 2 }).removed).toBe(1);
  });
});

describe("leaks", () => {
  it("reports only new entries that match a prefix", () => {
    const dir = tempDir("leaks-");
    entry(dir, "aos-done-repo-1");
    const before = snapshot(dir, ["aos-done-repo-"]);
    entry(dir, "aos-done-repo-2");
    entry(dir, "other-3");
    expect(leaks(dir, ["aos-done-repo-"], before)).toEqual(["aos-done-repo-2"]);
  });
});

describe("testTmpPrefixes", () => {
  it("finds the prefixes the tests create, none too short to be safe", () => {
    const prefixes = testTmpPrefixes(process.cwd());
    expect(prefixes).toContain("aos-done-repo-");
    expect(prefixes).toContain("agentos-link-");
    expect(prefixes.every((p) => p.length >= 4)).toBe(true);
  });
});

describe("the run's temp root", () => {
  it("holds this file's temp folder, db and home", () => {
    const fileDir = process.env.TMPDIR!;
    expect(basename(fileDir)).toMatch(/^f-/);
    expect(basename(dirname(fileDir))).toMatch(/^aos-t-/);
    expect(tmpdir().startsWith(fileDir)).toBe(true);
    for (const v of ["DB_PATH", "HOME", "AGENTOS_KEPT_DIR"])
      expect(process.env[v]!.startsWith(fileDir)).toBe(true);
  });
});

describe("worktreeLeaks", () => {
  const worktree = (dir: string, name: string, gitdir: string) => {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, ".git"), `gitdir: ${gitdir}\n`);
  };

  it("flags a new worktree whose repository is in this run's temp root", () => {
    const dir = tempDir("aos-wl-");
    const root = "/var/folders/xx/T/aos-t-run";
    worktree(dir, "old-one", `${root}/f-1/repo/.git/worktrees/old-one`);
    worktree(dir, "repo-quick-a", `${root}/f-1/repo/.git/worktrees/a`);
    worktree(dir, "live-task", "/Users/someone/proj/.git/worktrees/live-task");
    mkdirSync(join(dir, "no-git"));
    expect(worktreeLeaks(dir, new Set(["old-one"]), [root])).toEqual([
      "repo-quick-a",
    ]);
  });

  it("is empty for a folder that isn't there", () => {
    expect(worktreeLeaks("/nope/nowhere", new Set(), ["/x"])).toEqual([]);
  });
});
