import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { readUsageConfig, USAGE_DEFAULTS, USAGE_KEYS } from "./config";
import { exclusive, usageBusy } from "./nightly";

const set = (key: string, value: string) =>
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);

beforeEach(() => {
  for (const key of Object.values(USAGE_KEYS))
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
});

describe("readUsageConfig", () => {
  it("takes thresholds as set", () => {
    set(USAGE_KEYS.costPct, "20");
    set(USAGE_KEYS.baselineDays, "5");
    expect(readUsageConfig()).toMatchObject({ costPct: 20, baselineDays: 5 });
  });

  it("keeps the default for a day count that isn't a positive whole number", () => {
    for (const bad of ["0", "-3", "2.5", "abc"]) {
      set(USAGE_KEYS.baselineDays, bad);
      set(USAGE_KEYS.avgDays, bad);
      const c = readUsageConfig();
      expect(c.baselineDays).toBe(USAGE_DEFAULTS.baselineDays);
      expect(c.avgDays).toBe(USAGE_DEFAULTS.avgDays);
    }
  });
});

describe("exclusive", () => {
  it("lets one pass run at a time and frees the flag after", async () => {
    let release = () => {};
    const first = exclusive(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    expect(usageBusy()).toBe(true);
    expect(await exclusive(async () => {})).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(usageBusy()).toBe(false);
    await expect(
      exclusive(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(usageBusy()).toBe(false);
  });
});
