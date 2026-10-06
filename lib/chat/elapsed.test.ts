import { describe, expect, it } from "vitest";
import { formatElapsed } from "./elapsed";

describe("formatElapsed", () => {
  it("reads as seconds, minutes, then hours", () => {
    expect(formatElapsed(42_000)).toBe("42s");
    expect(formatElapsed(134_000)).toBe("2m 14s");
    expect(formatElapsed(3_780_000)).toBe("1h 3m");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
