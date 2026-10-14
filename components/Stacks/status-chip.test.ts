import { describe, expect, it } from "vitest";
import { CHIP, chipFor, type ChipStatus } from "./status-chip";

const coloured = (tone: string) => /amber|emerald|destructive/.test(tone);

describe("status chip colour", () => {
  it.each(["starting", "running", "pr", "landing"] as ChipStatus[])(
    "%s is neutral with an icon",
    (s) => {
      expect(coloured(CHIP[s].tone)).toBe(false);
      expect(CHIP[s].tone).not.toContain("primary");
      expect(CHIP[s].icon).not.toBeNull();
    }
  );

  it.each(["merged", "done", "landed"] as ChipStatus[])("%s is green", (s) =>
    expect(CHIP[s].tone).toContain("emerald")
  );
  it("failed is red", () => expect(CHIP.failed.tone).toContain("destructive"));
  it.each(["held", "paused"] as ChipStatus[])("%s is amber", (s) =>
    expect(CHIP[s].tone).toContain("amber")
  );

  it("needs-you overrides status with amber", () => {
    const c = chipFor("running", { attention: true });
    expect(c.label).toBe("Needs you");
    expect(c.tone).toContain("amber");
  });

  it("a running stack reads Running, neutral", () => {
    const c = chipFor("running", { stack: true });
    expect(c.label).toBe("Running");
    expect(coloured(c.tone)).toBe(false);
  });

  it("no status uses the accent", () => {
    for (const c of Object.values(CHIP))
      expect(c.tone).not.toContain("primary");
  });
});
