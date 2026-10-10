import { describe, expect, it } from "vitest";
import { parseTaskLimit, taskLimitLabel } from "./task-limit";

describe("parseTaskLimit", () => {
  it("is no limit when off, whatever the box says", () => {
    expect(parseTaskLimit(false, "")).toEqual({ limit: null });
    expect(parseTaskLimit(false, "abc")).toEqual({ limit: null });
  });

  it("takes a whole number from 1 when on", () => {
    expect(parseTaskLimit(true, "3")).toEqual({ limit: 3 });
    expect(parseTaskLimit(true, " 1 ")).toEqual({ limit: 1 });
  });

  it("refuses what the server would", () => {
    for (const bad of ["", "0", "-2", "2.5", "two"])
      expect(parseTaskLimit(true, bad)).toEqual({
        error: "A whole number from 1",
      });
  });
});

describe("taskLimitLabel", () => {
  it("reads off by default", () => {
    expect(taskLimitLabel(null)).toBe("Off");
    expect(taskLimitLabel(undefined)).toBe("Off");
    expect(taskLimitLabel(4)).toBe("4 at a time");
  });
});
