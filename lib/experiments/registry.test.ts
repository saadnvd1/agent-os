import { describe, expect, it } from "vitest";
import { EXPERIMENTS, getExperiment, isExperimentId } from "./registry";

describe("the experiment registry", () => {
  it("has unique kebab-case ids and every field filled", () => {
    const ids = EXPERIMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EXPERIMENTS) {
      expect(e.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(e.name).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.area).toBeTruthy();
      expect(["experimental", "beta"]).toContain(e.status);
    }
  });

  it("knows its ids", () => {
    expect(isExperimentId("learning-cards")).toBe(true);
    expect(isExperimentId("nope")).toBe(false);
    expect(getExperiment("learning-cards").name).toBe("Learning cards");
  });
});
