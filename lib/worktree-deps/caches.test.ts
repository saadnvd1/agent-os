import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { defaultCaches, seedBuildCaches } from "./caches";
import { tempDir } from "@/lib/test-temp";

let tmp: string, source: string, worktree: string;
const write = (root: string, rel: string, body = "x") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const read = (root: string, rel: string) =>
  fs.readFileSync(path.join(root, rel), "utf-8");

beforeEach(() => {
  tmp = fs.realpathSync(tempDir("aos-caches-"));
  source = path.join(tmp, "source");
  worktree = path.join(tmp, "worktree");
  fs.mkdirSync(source);
  fs.mkdirSync(worktree);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const seed = (extra: object = {}) =>
  seedBuildCaches({
    sourcePath: source,
    worktreePath: worktree,
    mode: "copy",
    ...extra,
  });

describe("defaultCaches", () => {
  it("names a Node project's tsbuildinfo and vitest cache, and Next's only with next", async () => {
    write(source, "package.json", "{}");
    expect(await defaultCaches(source)).toEqual(["*.tsbuildinfo"]);
    write(source, "package.json", '{"dependencies":{"next":"16"}}');
    expect(await defaultCaches(source)).toContain(path.join(".next", "cache"));
  });

  it("covers workspaces and a project with nothing", async () => {
    write(source, "package.json", "{}");
    write(source, "web/package.json", '{"devDependencies":{"next":"16"}}');
    write(source, "web/node_modules/.keep");
    const got = await defaultCaches(source);
    expect(got).toContain(path.join("web", "*.tsbuildinfo"));
    expect(got).toContain(path.join("web", ".next", "cache"));
    expect(await defaultCaches(path.join(tmp, "nothing"))).toEqual([]);
  });
});

describe("seedBuildCaches", () => {
  it("copies declared caches and globs, skipping what is already there", async () => {
    write(source, "a.tsbuildinfo", "A");
    write(source, "b.txt", "B");
    write(source, ".next/cache/turbo/f", "F");
    write(source, "keep/c", "new");
    write(worktree, "keep/c", "mine");
    const r = await seed({
      paths: ["*.tsbuildinfo", ".next/cache", "keep/c", "missing"],
    });
    expect(r.seeded.map((s) => s.rel).sort()).toEqual([
      ".next/cache",
      "a.tsbuildinfo",
    ]);
    expect(read(worktree, ".next/cache/turbo/f")).toBe("F");
    expect(fs.existsSync(path.join(worktree, "b.txt"))).toBe(false);
    expect(read(worktree, "keep/c")).toBe("mine");
    expect(
      fs.existsSync(path.join(worktree, "a.tsbuildinfo.aos-partial"))
    ).toBe(false);
  });

  it("never writes back: the seeded copy is its own file", async () => {
    write(source, ".next/cache/f", "original");
    write(source, "t.tsbuildinfo", "original");
    await seed({ paths: [".next/cache", "t.tsbuildinfo"] });
    for (const rel of [".next/cache/f", "t.tsbuildinfo"]) {
      const a = path.join(source, rel);
      const b = path.join(worktree, rel);
      expect(fs.statSync(b).ino).not.toBe(fs.statSync(a).ino);
      expect(fs.statSync(b).nlink).toBe(1);
      fs.appendFileSync(b, " + mine");
      expect(fs.readFileSync(a, "utf-8")).toBe("original");
    }
    fs.rmSync(path.join(worktree, ".next"), { recursive: true });
    expect(read(source, ".next/cache/f")).toBe("original");
  });

  it("skips a cache bigger than the cap when it can't clone", async () => {
    write(source, ".next/cache/big", "x".repeat(4096));
    const r = await seed({ paths: [".next/cache"], maxCopyMb: 0.001 });
    expect(r.seeded).toEqual([]);
    expect(r.skipped[0]).toMatchObject({ rel: ".next/cache" });
    expect(r.skipped[0].why).toMatch(/bigger than/);
    expect(fs.existsSync(path.join(worktree, ".next"))).toBe(false);
  });

  it("refuses what resolves outside the checkout or the worktree", async () => {
    const outside = path.join(tmp, "outside");
    write(outside, "secret", "s");
    fs.symlinkSync(outside, path.join(source, "cache"));
    fs.symlinkSync(outside, path.join(worktree, "link"));
    write(source, "link/f", "f");
    const r = await seed({ paths: ["cache", "link/f"] });
    expect(r.seeded).toEqual([]);
    expect(r.skipped.map((s) => s.rel).sort()).toEqual(["cache", "link/f"]);
    expect(fs.existsSync(path.join(outside, "f"))).toBe(false);
  });

  it("skips a cache older than the worktree's base commit, and a huge clone", async () => {
    write(source, "old.tsbuildinfo", "old");
    write(source, "new.tsbuildinfo", "new");
    write(source, ".next/cache/big", "x".repeat(4096));
    const t = Date.now();
    fs.utimesSync(
      path.join(source, "old.tsbuildinfo"),
      (t - 9e6) / 1000,
      (t - 9e6) / 1000
    );
    const r = await seed({
      paths: ["*.tsbuildinfo"],
      freshAfterMs: t - 1e6,
    });
    expect(r.seeded.map((s) => s.rel)).toEqual(["new.tsbuildinfo"]);
    expect(r.skipped).toEqual([
      { rel: "old.tsbuildinfo", why: "older than the worktree's base commit" },
    ]);
    const huge = await seed({
      paths: [".next/cache"],
      mode: "clone",
      maxCloneMb: 0.001,
    });
    expect(huge.skipped[0].why).toMatch(/bigger than/);
    expect(fs.existsSync(path.join(worktree, ".next"))).toBe(false);
  });

  it("skips a cache git does not ignore", async () => {
    const { execFileSync } = await import("child_process");
    execFileSync("git", ["init", "-q"], { cwd: worktree });
    fs.writeFileSync(path.join(worktree, ".gitignore"), ".next/\n");
    write(source, ".next/cache/f", "F");
    write(source, "stray/f", "S");
    const r = await seed({ paths: [".next/cache", "stray"] });
    expect(r.seeded.map((s) => s.rel)).toEqual([".next/cache"]);
    expect(r.skipped).toEqual([{ rel: "stray", why: "not ignored by git" }]);
  });

  it("does nothing, and does not throw, with no source cache", async () => {
    expect(await seed({ paths: [".next/cache"] })).toEqual({
      seeded: [],
      skipped: [],
    });
  });
});
