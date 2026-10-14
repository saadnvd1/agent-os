import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { experimentOn, experimentsLocked, setExperiment } from ".";

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'experiments.%'`).run();
});

describe("experimentOn", () => {
  it("is off until someone turns it on", () => {
    expect(experimentOn("learning-cards")).toBe(false);
  });

  it("round-trips the toggle through the settings table", () => {
    setExperiment("learning-cards", true);
    expect(experimentOn("learning-cards")).toBe(true);
    setExperiment("learning-cards", false);
    expect(experimentOn("learning-cards")).toBe(false);
    expect(
      db
        .prepare(
          `SELECT 1 FROM settings WHERE key = 'experiments.learning-cards'`
        )
        .get()
    ).toBeUndefined();
  });

  it("is pinned off by the environment, even when switched on", () => {
    setExperiment("learning-cards", true);
    const env = { AGENTOS_EXPERIMENTS: "off" };
    expect(experimentsLocked(env)).toBe(true);
    expect(experimentOn("learning-cards", env)).toBe(false);
  });
});
