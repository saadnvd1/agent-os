import { describe, expect, it } from "vitest";
import { needsShrink, renamed, SHRINK_STEPS, targetSize } from "./shrinkPlan";

describe("shrink plan", () => {
  it("shrinks a big photo and leaves a small one alone", () => {
    expect(needsShrink(5712, 4284, 8_000_000, 3_750_000)).toBe(true);
    expect(needsShrink(1200, 800, 4_000_000, 3_750_000)).toBe(true);
    expect(needsShrink(3000, 1000, 100_000, 3_750_000)).toBe(true);
    expect(needsShrink(2000, 1500, 500_000, 3_750_000)).toBe(false);
  });

  it("fits the long edge and keeps the aspect ratio", () => {
    expect(targetSize(5712, 4284, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(targetSize(4284, 5712, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(targetSize(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });

  it("steps quality down before size", () => {
    expect(SHRINK_STEPS.map((s) => `${s.maxEdge}@${s.quality}`)).toEqual([
      "2000@0.85",
      "2000@0.75",
      "2000@0.65",
      "1600@0.75",
      "1600@0.65",
    ]);
  });

  it("swaps the extension", () => {
    expect(renamed("IMG_1.HEIC", "jpg")).toBe("IMG_1.jpg");
    expect(renamed("a.b.png", "jpg")).toBe("a.b.jpg");
    expect(renamed("noext", "jpg")).toBe("noext.jpg");
  });
});
