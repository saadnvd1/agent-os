import { afterAll, describe, expect, it } from "vitest";
import { awayRange } from "./time";

// A zone that isn't UTC, so reading UTC as local would show.
const zone = process.env.TZ;
process.env.TZ = "America/Chicago";
afterAll(() => {
  process.env.TZ = zone;
});

describe("the report's time range", () => {
  it("reads SQLite's UTC times as UTC, not local", () => {
    expect(awayRange("2026-10-11 03:01:00", "2026-10-11 05:30:00")).toMatch(
      /^Sat 10:01\sPM to Sun 12:30\sAM$/
    );
    expect(awayRange("2026-10-11 15:00:00", "2026-10-11 17:30:00")).toMatch(
      /^10:00\sAM to 12:30\sPM$/
    );
  });
});
