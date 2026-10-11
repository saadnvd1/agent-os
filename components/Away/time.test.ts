import { describe, expect, it } from "vitest";
import { awayRange } from "./time";

describe("the report's time range", () => {
  it("reads SQLite's UTC times as UTC, not local", () => {
    const local = (iso: string) =>
      new Date(iso).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    // The day shows only when it changes, which depends on the zone.
    const range = awayRange("2026-10-11 03:01:00", "2026-10-11 05:30:00");
    expect(range).toMatch(
      new RegExp(
        `${local("2026-10-11T03:01:00Z")} to (\\w+ )?${local("2026-10-11T05:30:00Z")}$`
      )
    );
  });
});
