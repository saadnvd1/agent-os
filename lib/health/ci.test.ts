import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baseline, observeCi, pendingCi } from "./ci";
import { MIN } from "./types";

const NOW = Date.parse("2026-10-14T18:00:00Z");
type F = Parameters<typeof observeCi>[1][number];
const f = (
  checks: "pending" | "pass" | "fail",
  head = "aaa",
  state: "OPEN" | "MERGED" = "OPEN"
): F => ({
  project: "api",
  task: {
    state: "review",
    blocked: null,
    pr: { number: 7, url: "u", state, checks, head },
  },
});

beforeEach(() => db.exec(`DELETE FROM ci_runs`));

describe("CI runs", () => {
  it("starts timing at the first pending look and stops when it settles", () => {
    observeCi("w", [f("pending")], NOW);
    observeCi("w", [f("pending")], NOW + 5 * MIN);
    expect(pendingCi(NOW + 6 * MIN)).toMatchObject([
      { prNumber: 7, pendingSince: NOW, workspaceId: "w" },
    ]);
    observeCi("w", [f("pass")], NOW + 8 * MIN);
    expect(pendingCi(NOW + 9 * MIN)).toEqual([]);
    expect(baseline("api")).toEqual([8 * MIN]);
  });

  it("drops the run on an older head when a new one is pushed", () => {
    observeCi("w", [f("pending", "aaa")], NOW);
    observeCi("w", [f("pending", "bbb")], NOW + MIN);
    expect(pendingCi(NOW + 2 * MIN).map((r) => r.head)).toEqual(["bbb"]);
  });

  it("forgets a pending run once the PR is no longer open", () => {
    observeCi("w", [f("pending")], NOW);
    observeCi("w", [f("pending", "aaa", "MERGED")], NOW + MIN);
    expect(pendingCi(NOW + 2 * MIN)).toEqual([]);
  });

  it("ignores a run pending for over a day: that one is lost, not slow", () => {
    observeCi("w", [f("pending")], NOW);
    expect(pendingCi(NOW + 25 * 60 * MIN)).toEqual([]);
  });
});
