import { describe, expect, it } from "vitest";
import { buildSnapshot, summarize } from "./overlapCache";
import type { Claim } from "./types";

const claim = (over: Partial<Claim>): Claim => ({
  id: "c",
  origin: "me",
  originName: "here",
  viaMachine: null,
  hops: 0,
  source: "session",
  sessionId: null,
  sessionName: null,
  repo: "git.example.test/team/widgets",
  branch: null,
  base: "main",
  goal: "Do thing",
  files: [],
  filesMore: 0,
  prUrl: null,
  startedAt: 0,
  expiresAt: 1e12,
  released: null,
  updatedAt: 0,
  ...over,
});

const FILES = ["a.ts", "b.ts", "c.ts"];

describe("buildSnapshot", () => {
  it("gives a pill only to this machine's sessions", () => {
    const mine = claim({ id: "s-1", sessionId: "1", files: FILES });
    const theirs = claim({
      id: "r-1",
      origin: "box",
      originName: "box",
      goal: "Other work",
      files: FILES,
    });
    const snap = buildSnapshot([mine, theirs], "me");
    expect([...snap.bySession.keys()]).toEqual(["1"]);
    expect(snap.bySession.get("1")).toMatchObject({
      strength: "strong",
      machine: "box",
      shared: 3,
      claimId: "r-1",
      mineId: "s-1",
    });
  });

  it("keeps the strongest of a session's overlaps", () => {
    const mine = claim({
      id: "s-1",
      sessionId: "1",
      files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      branch: "feature/m",
    });
    const weak = claim({
      id: "r-weak",
      goal: "Migrate billing tables",
      origin: "x",
      originName: "pc",
      files: ["a.ts", "b.ts", "x.ts", "y.ts", "z.ts"],
      branch: "feature/o",
    });
    const strong = claim({
      id: "r-strong",
      origin: "y",
      originName: "box",
      branch: "feature/m",
    });
    expect(
      buildSnapshot([mine, weak, strong], "me").bySession.get("1")?.machine
    ).toBe("box");
  });

  it("drops paths from the claim list and keeps a count", () => {
    const c = claim({ files: FILES, filesMore: 7 });
    expect(summarize(c)).not.toHaveProperty("files");
    expect(summarize(c).fileCount).toBe(10);
  });

  it("is empty with no claims", () => {
    const snap = buildSnapshot([], "me");
    expect(snap.claims).toEqual([]);
    expect(snap.bySession.size).toBe(0);
  });
});
