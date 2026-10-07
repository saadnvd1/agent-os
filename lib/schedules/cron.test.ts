import { describe, expect, it } from "vitest";
import {
  cronError,
  cronPreset,
  describeCron,
  formatRunTime,
  nextRun,
  nextRuns,
  presetCron,
  prevRun,
} from "./cron";

const TZ = "America/Chicago";
const iso = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString();
const at = (s: string) => Date.parse(s);

describe("nextRun", () => {
  it("finds the next minute for * * * * *", () => {
    expect(iso(nextRun("* * * * *", at("2026-10-07T14:00:30Z"), TZ))).toBe(
      "2026-10-07T14:01:00.000Z"
    );
  });

  it("reads hours in the zone's wall clock (CDT is UTC-5)", () => {
    expect(iso(nextRun("0 9 * * *", at("2026-10-07T00:00:00Z"), TZ))).toBe(
      "2026-10-07T14:00:00.000Z"
    );
  });

  it("is strictly after from", () => {
    expect(iso(nextRun("0 9 * * *", at("2026-10-07T14:00:00Z"), TZ))).toBe(
      "2026-10-08T14:00:00.000Z"
    );
  });

  it("skips weekends for weekdays", () => {
    // Friday 2026-10-09 10:00 CDT -> Monday 9:00.
    expect(iso(nextRun("0 9 * * 1-5", at("2026-10-09T15:00:00Z"), TZ))).toBe(
      "2026-10-12T14:00:00.000Z"
    );
  });

  it("ORs day-of-month and day-of-week when both are set", () => {
    // The 15th or any Monday; from Sat Oct 10 the next is Mon Oct 12.
    expect(iso(nextRun("0 0 15 * 1", at("2026-10-10T12:00:00Z"), TZ))).toBe(
      "2026-10-12T05:00:00.000Z"
    );
  });

  it("returns null for a date that never comes", () => {
    expect(nextRun("0 0 30 2 *", at("2026-01-01T00:00:00Z"), TZ)).toBeNull();
  });

  it("names months and days, and treats 7 as Sunday", () => {
    expect(iso(nextRun("0 12 * jan sun", at("2026-10-07T00:00:00Z"), TZ))).toBe(
      "2027-01-03T18:00:00.000Z"
    );
    expect(nextRun("0 12 * * 7", 0, TZ)).toBe(nextRun("0 12 * * 0", 0, TZ));
  });
});

describe("DST in America/Chicago", () => {
  it("keeps 9:00 AM local across fall-back (offset -5 -> -6)", () => {
    const runs = nextRuns("0 9 * * *", at("2026-10-31T15:00:00Z"), 2, TZ);
    expect(runs.map(iso)).toEqual([
      "2026-11-01T15:00:00.000Z", // 9:00 CST
      "2026-11-02T15:00:00.000Z",
    ]);
    expect(formatRunTime(runs[0], TZ)).toContain("9:00 AM");
  });

  it("keeps 9:00 AM local across spring-forward (offset -6 -> -5)", () => {
    const runs = nextRuns("0 9 * * *", at("2026-03-07T16:00:00Z"), 2, TZ);
    expect(runs.map(iso)).toEqual([
      "2026-03-08T14:00:00.000Z", // 9:00 CDT
      "2026-03-09T14:00:00.000Z",
    ]);
  });

  it("runs a skipped wall time once, an hour on", () => {
    // 2026-03-08 2:30 AM doesn't exist; it runs at 3:30 CDT (08:30Z).
    const runs = nextRuns("30 2 * * *", at("2026-03-07T12:00:00Z"), 3, TZ);
    expect(runs.map(iso)).toEqual([
      "2026-03-08T08:30:00.000Z",
      "2026-03-09T07:30:00.000Z",
      "2026-03-10T07:30:00.000Z",
    ]);
  });

  it("runs a doubled wall time once, the first time", () => {
    // 2026-11-01 1:30 AM happens at 06:30Z (CDT) and 07:30Z (CST).
    const runs = nextRuns("30 1 * * *", at("2026-10-31T12:00:00Z"), 2, TZ);
    expect(runs.map(iso)).toEqual([
      "2026-11-01T06:30:00.000Z",
      "2026-11-02T07:30:00.000Z",
    ]);
  });

  it("an hourly schedule runs each wall hour once across fall-back", () => {
    const runs = nextRuns("0 * * * *", at("2026-11-01T04:30:00Z"), 4, TZ);
    expect(runs.map(iso)).toEqual([
      "2026-11-01T05:00:00.000Z", // 12:00 AM CDT
      "2026-11-01T06:00:00.000Z", // 1:00 AM CDT (07:00Z is 1:00 again: not run)
      "2026-11-01T08:00:00.000Z", // 2:00 AM CST
      "2026-11-01T09:00:00.000Z", // 3:00 AM CST
    ]);
  });
});

describe("prevRun", () => {
  it("finds the latest run at or before a time", () => {
    expect(iso(prevRun("0 9 * * *", at("2026-10-07T13:59:00Z"), TZ))).toBe(
      "2026-10-06T14:00:00.000Z"
    );
    expect(iso(prevRun("0 9 * * *", at("2026-10-07T14:00:00Z"), TZ))).toBe(
      "2026-10-07T14:00:00.000Z"
    );
  });

  it("agrees with nextRun across DST (the scheduler decides with prevRun)", () => {
    // Fall-back: 1:00 AM happens at 06:00Z and 07:00Z; only the first runs.
    expect(iso(prevRun("0 * * * *", at("2026-11-01T07:30:00Z"), TZ))).toBe(
      "2026-11-01T06:00:00.000Z"
    );
    expect(iso(prevRun("30 1 * * *", at("2026-11-01T07:45:00Z"), TZ))).toBe(
      "2026-11-01T06:30:00.000Z"
    );
    // Spring-forward: the skipped 2:30 AM ran at 3:30 CDT.
    expect(iso(prevRun("30 2 * * *", at("2026-03-08T09:00:00Z"), TZ))).toBe(
      "2026-03-08T08:30:00.000Z"
    );
  });

  it("walking minute by minute through fall-back, each wall hour is due once", () => {
    const due = new Set<string>();
    for (
      let t = at("2026-11-01T04:30:00Z");
      t < at("2026-11-01T10:00:00Z");
      t += 60_000
    )
      due.add(iso(prevRun("0 * * * *", t, TZ))!);
    expect([...due]).toEqual([
      "2026-11-01T04:00:00.000Z", // 11 PM CDT
      "2026-11-01T05:00:00.000Z", // 12 AM CDT
      "2026-11-01T06:00:00.000Z", // 1 AM CDT
      "2026-11-01T08:00:00.000Z", // 2 AM CST
      "2026-11-01T09:00:00.000Z", // 3 AM CST
    ]);
  });

  it("is the current minute for * * * * *", () => {
    expect(iso(prevRun("* * * * *", at("2026-10-07T14:00:59Z"), TZ))).toBe(
      "2026-10-07T14:00:00.000Z"
    );
  });
});

describe("presets", () => {
  it("round-trips each preset", () => {
    for (const kind of ["hourly", "daily", "weekdays", "weekly"] as const) {
      const p = { kind, minute: 15, hour: 17, weekday: 3 };
      const back = cronPreset(presetCron(p));
      expect(back?.kind).toBe(kind);
      expect(back?.minute).toBe(15);
      if (kind !== "hourly") expect(back?.hour).toBe(17);
    }
  });

  it("describes in 12-hour time", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
    expect(describeCron("30 17 * * *")).toBe("Every day at 5:30 PM");
    expect(describeCron("0 0 * * 1")).toBe("Mondays at 12:00 AM");
    expect(describeCron("* * * * *")).toBe("Every minute");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("0 */2 * * *")).toBe("0 */2 * * *");
  });

  it("explains a bad expression", () => {
    expect(cronError("* * *")).toMatch(/5 fields/);
    expect(cronError("61 * * * *")).toMatch(/outside/);
    expect(cronError("*/5 * * * *")).toBeNull();
  });
});
