import { describe, it, expect } from "vitest";
import { lineDiff, shortPath } from "./diff";

describe("lineDiff", () => {
  it("keeps unchanged lines as context and marks only what changed", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(d.map((l) => `${l.op}${l.text}`)).toEqual([
      " a",
      "-b",
      "+B",
      " c",
      "+d",
    ]);
  });

  it("treats a new file as all additions", () => {
    expect(lineDiff("", "x\ny").map((l) => l.op)).toEqual(["+", "+"]);
  });
});

describe("shortPath", () => {
  it("keeps the last few segments", () => {
    expect(shortPath("/Users/me/dev/app/src/math.ts")).toBe(
      "…/app/src/math.ts"
    );
    expect(shortPath("src/math.ts")).toBe("src/math.ts");
  });
});
