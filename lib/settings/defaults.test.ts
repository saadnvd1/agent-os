import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_COMPACT_TOKENS,
  DEFAULT_COMPACT_TOKENS,
  DEFAULT_INTERACTIVE_AUTO_COMPACT_TOKENS,
  DEFAULT_ORCHESTRATOR_TOKENS,
  MAX_REFRESH_TOKENS,
  MIN_REFRESH_TOKENS,
  refreshSettings,
} from "../chat/refresh";
import { DEFAULT_STALL_MINUTES } from "../chat/stall-limits";
import { SETTING_DEFAULTS, freshOnValue, type FreshKey } from "./defaults";

describe("the defaults registry", () => {
  it("is what an untouched server reads, for every context setting", () => {
    // The settings page shows and resets to the registry's values.
    expect(refreshSettings()).toEqual(SETTING_DEFAULTS.fresh);
  });

  it("is what the server's own constants hold", () => {
    expect(DEFAULT_ORCHESTRATOR_TOKENS).toBe(
      SETTING_DEFAULTS.fresh.orchestratorTokens
    );
    expect(DEFAULT_COMPACT_TOKENS).toBe(SETTING_DEFAULTS.fresh.compactTokens);
    expect(DEFAULT_AUTO_COMPACT_TOKENS).toBe(
      SETTING_DEFAULTS.fresh.autoCompactTokens
    );
    expect(DEFAULT_INTERACTIVE_AUTO_COMPACT_TOKENS).toBe(
      SETTING_DEFAULTS.fresh.interactiveAutoCompactTokens
    );
    expect(DEFAULT_STALL_MINUTES).toBe(SETTING_DEFAULTS.stallMinutes);
  });

  it("keeps the mid-turn default for your own sessions at 300k, not 200k", () => {
    expect(SETTING_DEFAULTS.fresh.interactiveAutoCompactTokens).toBe(300_000);
  });

  it("gives every switch something valid to turn on with", () => {
    for (const key of Object.keys(SETTING_DEFAULTS.fresh) as FreshKey[]) {
      const on = freshOnValue(key);
      expect(on).toBeGreaterThanOrEqual(MIN_REFRESH_TOKENS);
      expect(on).toBeLessThanOrEqual(MAX_REFRESH_TOKENS);
    }
  });
});
