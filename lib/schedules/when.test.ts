import { describe, expect, it } from "vitest";
import { parseWhen, relativeTime } from "./when";

const at = (s: string) => Date.parse(s);
// Wed Oct 7 2026, 8:00 CDT.
const NOW = at("2026-10-07T13:00:00Z");
const chi = (text: string, now = NOW) =>
  parseWhen(text, "America/Chicago", now);

describe("parseWhen", () => {
  it("reads ISO with an offset as absolute and without one in the zone", () => {
    expect(chi("2026-10-12T10:00:00Z")).toBe(at("2026-10-12T10:00:00Z"));
    expect(chi("2026-10-12T10:00:00-05:00")).toBe(at("2026-10-12T15:00:00Z"));
    expect(chi("2026-10-12T10:00")).toBe(at("2026-10-12T15:00:00Z"));
    expect(parseWhen("2026-10-12T10:00", "Europe/London", NOW)).toBe(
      at("2026-10-12T09:00:00Z")
    );
    expect(chi("2026-10-12")).toBe(at("2026-10-12T14:00:00Z"));
  });

  it("reads tomorrow, today, weekdays and bare clocks", () => {
    expect(chi("tomorrow 10am")).toBe(at("2026-10-08T15:00:00Z"));
    expect(chi("Tomorrow at 10:30 PM")).toBe(
      at("2026-10-08T03:30:00Z") + 86_400_000
    );
    expect(chi("today 5pm")).toBe(at("2026-10-07T22:00:00Z"));
    expect(chi("friday 9am")).toBe(at("2026-10-09T14:00:00Z"));
    expect(chi("next monday noon")).toBe(at("2026-10-12T17:00:00Z"));
    expect(chi("15:00")).toBe(at("2026-10-07T20:00:00Z"));
  });

  it("a bare clock that has passed means tomorrow, a passed weekday means next week", () => {
    expect(chi("7am")).toBe(at("2026-10-08T12:00:00Z"));
    expect(chi("wednesday 7am")).toBe(at("2026-10-14T12:00:00Z"));
    expect(chi("wednesday 9am")).toBe(at("2026-10-07T14:00:00Z"));
  });

  it("reads durations from now, exactly", () => {
    expect(chi("in 2h")).toBe(NOW + 2 * 3_600_000);
    expect(chi("in 90 minutes")).toBe(NOW + 90 * 60_000);
    expect(chi("in 1 day")).toBe(NOW + 86_400_000);
    expect(chi("in an hour")).toBe(NOW + 3_600_000);
    expect(chi("in 1h 30m")).toBe(NOW + 90 * 60_000);
  });

  it("keeps wall time across the spring-forward change", () => {
    // Sun Mar 8 2026: 2:00 CST jumps to 3:00 CDT.
    const before = at("2026-03-07T18:00:00Z");
    expect(chi("tomorrow 10am", before)).toBe(at("2026-03-08T15:00:00Z"));
    expect(chi("in 24h", before)).toBe(before + 86_400_000);
    // 2:30 doesn't exist that day; it moves forward to 3:30 CDT.
    expect(chi("2026-03-08T02:30")).toBe(at("2026-03-08T08:30:00Z"));
  });

  it("takes the first of a doubled fall-back hour", () => {
    // Sun Nov 1 2026: 1:30 happens at 06:30Z (CDT) and again at 07:30Z (CST).
    expect(chi("2026-11-01T01:30")).toBe(at("2026-11-01T06:30:00Z"));
    expect(chi("tomorrow 10am", at("2026-10-31T18:00:00Z"))).toBe(
      at("2026-11-01T16:00:00Z")
    );
  });

  it("refuses what it can't read", () => {
    for (const bad of [
      "",
      "soonish",
      "tomorrow",
      "tomorrow 25:00",
      "10",
      "2026-13-01T10:00",
      "2026-02-30",
      "in",
      "in 0h",
    ])
      expect(() => chi(bad), bad).toThrow(/Can't read/);
  });
});

describe("relativeTime", () => {
  it("is short and says which way", () => {
    expect(relativeTime(NOW + 17 * 3_600_000, NOW)).toBe("in 17h");
    expect(relativeTime(NOW + 5 * 60_000, NOW)).toBe("in 5m");
    expect(relativeTime(NOW + 3 * 86_400_000, NOW)).toBe("in 3d");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(relativeTime(NOW + 10_000, NOW)).toBe("in under a minute");
  });
});
