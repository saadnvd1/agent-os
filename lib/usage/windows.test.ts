import { describe, expect, it } from "vitest";
import { fromLast, fromPlan } from "./windows";

const NOW = Date.parse("2026-10-07T12:00:00Z");

describe("fromPlan", () => {
  it("reads a window's use and how long until it resets", () => {
    expect(
      fromPlan({ utilization: 33.6, resets_at: "2026-10-07T14:00:00Z" }, NOW)
    ).toEqual({ pct: 34, resetsIn: 7200 });
  });

  it("is unavailable when the plan doesn't say", () => {
    expect(fromPlan(null, NOW)).toBeNull();
    expect(fromPlan(undefined, NOW)).toBeNull();
    expect(fromPlan({ utilization: null, resets_at: null }, NOW)).toBeNull();
  });

  it("has no countdown for a bad reset time, and none below zero", () => {
    expect(fromPlan({ utilization: 5, resets_at: "soon" }, NOW)).toEqual({
      pct: 5,
      resetsIn: null,
    });
    expect(
      fromPlan({ utilization: 5, resets_at: "2026-10-07T11:00:00Z" }, NOW)
    ).toEqual({ pct: 5, resetsIn: 0 });
  });
});

describe("fromLast", () => {
  const nowSec = NOW / 1000;
  it("shows the last value seen, marked stale, while its window is open", () => {
    expect(
      fromLast(
        { pct: 42, resetsAt: nowSec + 600, sampledAt: nowSec - 3660 },
        nowSec
      )
    ).toEqual({
      pct: 42,
      resetsIn: 600,
      stale: true,
      sampledAt: (nowSec - 3660) * 1000,
      ageSec: 3660,
    });
  });

  it("shows nothing for a window that has since reset, or no value", () => {
    expect(
      fromLast(
        { pct: 42, resetsAt: nowSec - 1, sampledAt: nowSec - 9000 },
        nowSec
      )
    ).toBeNull();
    expect(fromLast(null, nowSec)).toBeNull();
  });
});
