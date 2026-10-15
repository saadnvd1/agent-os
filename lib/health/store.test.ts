import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  CLEAR_AFTER_MS,
  MUTE_MS,
  REOPEN_MS,
  closedSince,
  dismiss,
  markWoken,
  needsWake,
  openAnomalies,
  recordTrips,
} from "./store";
import { NOW, trip } from "./fixtures";
import { MIN, CHECKS } from "./types";

const EVAL = CHECKS.filter((c) => c !== "piece-dup");
beforeEach(() => db.exec(`DELETE FROM health_anomalies`));

describe("recording trips", () => {
  it("opens once and only bumps while it keeps tripping", () => {
    expect(recordTrips([trip()], EVAL, NOW).opened).toHaveLength(1);
    for (let i = 1; i <= 9; i++) {
      const r = recordTrips([trip()], EVAL, NOW + i * MIN);
      expect(r.opened).toEqual([]);
      expect(r.raised).toEqual([]);
    }
    const [row] = openAnomalies();
    expect(row.hits).toBe(10);
    expect(openAnomalies()).toHaveLength(1);
  });

  it("reports a rise from warn to high, once, and never a fall", () => {
    recordTrips([trip()], EVAL, NOW);
    expect(
      recordTrips([trip({ severity: "high" })], EVAL, NOW + MIN).raised
    ).toHaveLength(1);
    expect(
      recordTrips([trip({ severity: "high" })], EVAL, NOW + 2 * MIN).raised
    ).toEqual([]);
    recordTrips([trip({ severity: "warn" })], EVAL, NOW + 3 * MIN);
    expect(openAnomalies()[0].severity).toBe("high");
  });

  it("clears only after the check has been quiet for a while", () => {
    recordTrips([trip()], EVAL, NOW);
    expect(recordTrips([], EVAL, NOW + CLEAR_AFTER_MS - 1).closed).toEqual([]);
    const r = recordTrips([], EVAL, NOW + CLEAR_AFTER_MS);
    expect(r.closed).toHaveLength(1);
    expect(r.closed[0].close_reason).toBe("cleared");
    expect(openAnomalies()).toEqual([]);
  });

  it("leaves an anomaly of a check that didn't run alone", () => {
    recordTrips([trip({ check: "piece-dup", subject: "piece:1" })], [], NOW);
    expect(recordTrips([], EVAL, NOW + 60 * MIN).closed).toEqual([]);
    expect(openAnomalies()).toHaveLength(1);
  });

  it("reopens the same row when it returns within half an hour", () => {
    recordTrips([trip()], EVAL, NOW);
    const [first] = openAnomalies();
    recordTrips([], EVAL, NOW + CLEAR_AFTER_MS);
    const back = recordTrips([trip()], EVAL, NOW + CLEAR_AFTER_MS + 10 * MIN);
    expect(back.opened).toEqual([]);
    expect(openAnomalies().map((r) => r.id)).toEqual([first.id]);
  });

  it("opens a new row when it returns after that", () => {
    recordTrips([trip()], EVAL, NOW);
    recordTrips([], EVAL, NOW + CLEAR_AFTER_MS);
    const later = recordTrips(
      [trip()],
      EVAL,
      NOW + CLEAR_AFTER_MS + REOPEN_MS + MIN
    );
    expect(later.opened).toHaveLength(1);
    expect(closedSince(0)).toHaveLength(1);
  });

  it("keeps two subjects of one check apart", () => {
    recordTrips([trip({ subject: "a" }), trip({ subject: "b" })], EVAL, NOW);
    expect(openAnomalies()).toHaveLength(2);
  });
});

describe("dismissing", () => {
  it("closes it and mutes that subject for a day", () => {
    recordTrips([trip()], EVAL, NOW);
    const [row] = openAnomalies();
    expect(dismiss(row.id, NOW + MIN)).toBe(true);
    expect(openAnomalies()).toEqual([]);
    expect(recordTrips([trip()], EVAL, NOW + 2 * MIN).opened).toEqual([]);
    expect(openAnomalies()).toEqual([]);
    const after = recordTrips([trip()], EVAL, NOW + MIN + MUTE_MS + MIN);
    expect(after.opened).toHaveLength(1);
  });
  it("says so for an id that isn't there", () => {
    expect(dismiss(999_999)).toBe(false);
  });
});

describe("waking", () => {
  it("wakes for a new anomaly once, and again only when it gets worse", () => {
    recordTrips([trip()], EVAL, NOW);
    let [row] = openAnomalies();
    expect(needsWake(row)).toBe(true);
    markWoken(row.id, "warn", NOW);
    [row] = openAnomalies();
    expect(needsWake(row)).toBe(false);
    recordTrips([trip({ severity: "high" })], EVAL, NOW + MIN);
    [row] = openAnomalies();
    expect(needsWake(row)).toBe(true);
    markWoken(row.id, "high", NOW + MIN);
    expect(needsWake(openAnomalies()[0])).toBe(false);
  });
});
