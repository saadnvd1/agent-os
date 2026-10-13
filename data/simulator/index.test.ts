import { describe, expect, it } from "vitest";
import { simulatorPollInterval } from "./index";

describe("simulatorPollInterval", () => {
  it("polls while a lease is coming up or booted", () => {
    for (const s of ["creating", "starting", "ready"] as const)
      expect(simulatorPollInterval(s)).toBeGreaterThan(0);
  });

  it("does not poll with no lease, an idle-shutdown one, a failed one, or before the first read", () => {
    for (const s of ["none", "shutdown", "failed", undefined] as const)
      expect(simulatorPollInterval(s)).toBe(false);
  });
});
