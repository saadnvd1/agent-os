import { describe, expect, it } from "vitest";
import { HEALTH_DEFAULTS, healthConfig, setHealthConfig } from "./config";

describe("thresholds", () => {
  it("are the defaults until set, and a bad value is the default too", () => {
    expect(healthConfig(() => null)).toEqual(HEALTH_DEFAULTS);
    const c = healthConfig(
      (k) =>
        ({
          "health.loadRedMinutes": "3",
          "health.bgQuietMinutes": "soon",
          "health.restartsMax": "-1",
        })[k] ?? null
    );
    expect(c.loadRedMinutes).toBe(3);
    expect(c.bgQuietMinutes).toBe(20);
    expect(c.restartsMax).toBe(2);
  });
  it("store a number, put the default back on null, and refuse the rest", () => {
    expect(setHealthConfig({ queueHeldMinutes: 90 }).errors).toEqual([]);
    expect(healthConfig().queueHeldMinutes).toBe(90);
    setHealthConfig({ queueHeldMinutes: null });
    expect(healthConfig().queueHeldMinutes).toBe(60);
    expect(setHealthConfig({ nope: 1 }).errors[0]).toContain("Unknown");
    expect(setHealthConfig({ loadRedMinutes: "abc" }).errors[0]).toContain(
      "number"
    );
    expect(healthConfig().loadRedMinutes).toBe(10);
  });
});
