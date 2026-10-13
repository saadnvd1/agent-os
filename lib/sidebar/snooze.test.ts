import { describe, expect, it } from "vitest";
import { snoozePreset, wakeLabel } from "./snooze";

const at = (iso: string, tz: string, preset: "tomorrow" | "next-week") =>
  snoozePreset(preset, new Date(iso), tz).toISOString();

describe("snoozePreset", () => {
  it("tomorrow is 9am local the next day, whatever the zone", () => {
    // Chicago evening is already the next UTC day.
    expect(at("2026-10-14T02:30:00Z", "America/Chicago", "tomorrow")).toBe(
      "2026-10-14T14:00:00.000Z"
    );
    expect(at("2026-10-13T15:00:00Z", "America/Chicago", "tomorrow")).toBe(
      "2026-10-14T14:00:00.000Z"
    );
    // Tokyo and Sydney are ahead of UTC: local date differs the other way.
    expect(at("2026-10-13T16:00:00Z", "Asia/Tokyo", "tomorrow")).toBe(
      "2026-10-15T00:00:00.000Z"
    );
    expect(at("2026-10-13T15:00:00Z", "Australia/Sydney", "tomorrow")).toBe(
      "2026-10-14T22:00:00.000Z"
    );
    expect(at("2026-10-13T10:00:00Z", "Asia/Kolkata", "tomorrow")).toBe(
      "2026-10-14T03:30:00.000Z"
    );
  });

  it("next week is 9am next Monday: a Monday waits seven days, a Sunday one", () => {
    const chi = (iso: string) => at(iso, "America/Chicago", "next-week");
    // 2026-10-13 is a Tuesday.
    expect(chi("2026-10-13T15:00:00Z")).toBe("2026-10-19T14:00:00.000Z");
    expect(chi("2026-10-18T15:00:00Z")).toBe("2026-10-19T14:00:00.000Z"); // Sunday
    expect(chi("2026-10-19T15:00:00Z")).toBe("2026-10-26T14:00:00.000Z"); // Monday
    expect(chi("2026-10-17T15:00:00Z")).toBe("2026-10-19T14:00:00.000Z"); // Saturday
  });

  it("keeps 9am local across a DST change", () => {
    // Spring forward 2026-03-08 in Chicago: Sat night to Sunday 9am CDT.
    expect(at("2026-03-08T01:00:00Z", "America/Chicago", "tomorrow")).toBe(
      "2026-03-08T14:00:00.000Z"
    );
    // Fall back 2026-11-01: Thursday to Monday 9am CST.
    expect(at("2026-10-29T15:00:00Z", "America/Chicago", "next-week")).toBe(
      "2026-11-02T15:00:00.000Z"
    );
    // London falls back 2026-10-25.
    expect(at("2026-10-24T12:00:00Z", "Europe/London", "tomorrow")).toBe(
      "2026-10-25T09:00:00.000Z"
    );
    expect(at("2026-10-23T12:00:00Z", "Europe/London", "tomorrow")).toBe(
      "2026-10-24T08:00:00.000Z"
    );
  });
});

describe("wakeLabel", () => {
  const tz = "America/Chicago";
  const now = Date.parse("2026-10-13T15:00:00Z"); // Tue 10am
  const label = (iso: string) => wakeLabel(Date.parse(iso), now, tz);
  it("reads today, tomorrow, a weekday and a far date", () => {
    expect(label("2026-10-13T23:30:00Z")).toBe("6:30 PM");
    expect(label("2026-10-14T14:00:00Z")).toBe("Tomorrow 9 AM");
    expect(label("2026-10-19T14:00:00Z")).toBe("Mon 9 AM");
    expect(label("2026-10-27T14:00:00Z")).toBe("Oct 27, 9 AM");
  });
});
