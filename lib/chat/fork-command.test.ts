import { describe, expect, it } from "vitest";
import { isForkCommand, withFork } from "./commands";

describe("fork command", () => {
  it("matches only the bare /fork", () => {
    expect(isForkCommand(" /Fork ")).toBe(true);
    expect(isForkCommand("/fork now")).toBe(false);
  });

  it("is added once, first", () => {
    const once = withFork([{ name: "clear", description: "x" } as never]);
    expect(once[0].name).toBe("fork");
    expect(withFork(once)).toBe(once);
  });
});
