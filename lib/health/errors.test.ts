import { beforeEach, describe, expect, it } from "vitest";
import { countError, errorRate, recentErrorLines, resetErrors } from "./errors";
import { MIN } from "./types";

const FAKE_KEY = "sk" + "-" + "abcdefghijklmnopqrstuvwxyz0123";

const NOW = Date.parse("2026-10-14T18:05:00Z");
beforeEach(() => resetErrors());

describe("error counting", () => {
  it("has no baseline until there's history", () => {
    for (let i = 0; i < 30; i++) countError("e", NOW);
    expect(errorRate(NOW)).toEqual({ recent: 30, baselineMean: 0 });
  });

  it("counts the current and previous bucket as recent, the rest as the baseline", () => {
    for (let b = 3; b <= 12; b++) countError("old", NOW - b * 10 * MIN);
    countError("a", NOW - 10 * MIN);
    countError("b", NOW);
    const r = errorRate(NOW);
    expect(r.recent).toBe(2);
    expect(r.baselineMean).toBeCloseTo(10 / 142, 5);
  });

  it("keeps redacted recent lines only", () => {
    countError(`fail ${FAKE_KEY}`, NOW - 90 * MIN);
    countError("fresh", NOW);
    expect(recentErrorLines(30, NOW - 60 * MIN)).toEqual(["fresh"]);
  });
});
