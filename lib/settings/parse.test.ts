import { describe, expect, it } from "vitest";
import { parseSettingNumber } from "./parse";

describe("parseSettingNumber", () => {
  const days = { min: 1, max: 365 };
  it("takes a whole number in range", () => {
    expect(parseSettingNumber(" 14 ", days)).toEqual({ value: 14 });
  });
  it("says why when it isn't, instead of dropping it", () => {
    for (const bad of ["", "abc", "1.5", "0", "366", "NaN"])
      expect(parseSettingNumber(bad, days)).toHaveProperty("error");
    expect(parseSettingNumber("1.5", days)).toEqual({
      error: "Enter a whole number from 1 to 365.",
    });
  });
  it("takes decimals when asked, and no upper bound", () => {
    expect(parseSettingNumber("0.5", { min: 0, integer: false })).toEqual({
      value: 0.5,
    });
    expect(parseSettingNumber("-1", { min: 0, integer: false })).toHaveProperty(
      "error"
    );
  });
});
