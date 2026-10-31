import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { isInterrupted, recoverBuild, recoverRun } from "./update-recover.mjs";

let dir: string;
const state = () => path.join(dir, "agent-os-update.json");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const commit = (msg: string) => {
  git(
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    msg
  );
  return git("rev-parse", "HEAD");
};
const write = (run: object) => fs.writeFileSync(state(), JSON.stringify(run));
const read = () => JSON.parse(fs.readFileSync(state(), "utf8"));
const NOW = Date.now();
const GONE = 2 ** 22 + 4321;

beforeEach(() => {
  dir = tempDir("aos-recover-");
});

describe("recoverBuild", () => {
  it("finishes a swap cut between its two renames", () => {
    fs.mkdirSync(path.join(dir, ".next-build"));
    fs.writeFileSync(path.join(dir, ".next-build/BUILD_ID"), "new");
    fs.mkdirSync(path.join(dir, ".next-prev"));
    fs.writeFileSync(path.join(dir, ".next-prev/BUILD_ID"), "old");
    expect(recoverBuild(dir)).toBe(".next-build");
    expect(fs.readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8")).toBe(
      "new"
    );
  });

  it("puts the previous build back when there's no new one", () => {
    fs.mkdirSync(path.join(dir, ".next-prev"));
    fs.writeFileSync(path.join(dir, ".next-prev/BUILD_ID"), "old");
    expect(recoverBuild(dir)).toBe(".next-prev");
    expect(fs.readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8")).toBe(
      "old"
    );
  });

  it("leaves a live build alone", () => {
    fs.mkdirSync(path.join(dir, ".next"));
    fs.writeFileSync(path.join(dir, ".next/BUILD_ID"), "live");
    fs.mkdirSync(path.join(dir, ".next-build"));
    fs.writeFileSync(path.join(dir, ".next-build/BUILD_ID"), "built");
    expect(recoverBuild(dir)).toBeNull();
    expect(fs.readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8")).toBe(
      "live"
    );
  });
});

describe("recoverRun", () => {
  let from: string;
  beforeEach(() => {
    git("init", "-q");
    from = commit("one");
    commit("two");
  });
  const run = (over: object = {}) => ({
    id: "r",
    phase: "building",
    from,
    startedAt: NOW - 10 * 60_000,
    updatedAt: NOW - 5 * 60_000,
    pid: GONE,
    ...over,
  });

  it("a run cut off after the pull puts the source back", () => {
    write(run({ stage: "pulled" }));
    expect(recoverRun(dir, state(), NOW)).toEqual(["source"]);
    expect(git("rev-parse", "HEAD")).toBe(from);
    expect(read()).toMatchObject({ phase: "failed", outcome: "interrupted" });
  });

  it("a run cut off after the dependencies swapped puts them back too", () => {
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules/which"), "new");
    fs.mkdirSync(path.join(dir, ".deps/prev"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".deps/prev/which"), "old");
    write(run({ stage: "deps_swapped" }));
    expect(recoverRun(dir, state(), NOW)).toEqual(["dependencies", "source"]);
    expect(fs.readFileSync(path.join(dir, "node_modules/which"), "utf8")).toBe(
      "old"
    );
  });

  it("a run cut off after the build swapped keeps the new version", () => {
    const head = git("rev-parse", "HEAD");
    write(run({ stage: "build_swapped", phase: "restarting" }));
    expect(recoverRun(dir, state(), NOW)).toEqual([]);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(read().outcome).toBe("interrupted");
  });

  it("leaves a run whose runner is alive, or that is finished", () => {
    write(run({ stage: "pulled", pid: process.pid }));
    expect(recoverRun(dir, state(), NOW)).toBeNull();
    write(run({ stage: "pulled", phase: "done" }));
    expect(recoverRun(dir, state(), NOW)).toBeNull();
    write(run({ stage: "pulled", updatedAt: NOW - 30_000 }));
    expect(recoverRun(dir, state(), NOW)).toBeNull();
  });

  it("an old-style run without stages is only marked, never reset", () => {
    const head = git("rev-parse", "HEAD");
    write({ id: "o", phase: "building", from, startedAt: NOW - 3_600_000 });
    expect(recoverRun(dir, state(), NOW)).toEqual([]);
    expect(git("rev-parse", "HEAD")).toBe(head);
  });

  it("isInterrupted needs both a stale heartbeat and a dead runner", () => {
    expect(isInterrupted(run(), NOW)).toBe(true);
    expect(isInterrupted(run({ pid: process.pid }), NOW)).toBe(false);
    expect(isInterrupted(null, NOW)).toBe(false);
  });

  it("runs as a script without failing the start", () => {
    write(run({ stage: "pulled" }));
    const out = execFileSync(
      process.execPath,
      [path.join(import.meta.dirname, "update-recover.mjs")],
      { cwd: dir, encoding: "utf8", env: { ...process.env, DB_PATH: "" } }
    );
    expect(out).toContain("interrupted");
    expect(git("rev-parse", "HEAD")).toBe(from);
  });
});
