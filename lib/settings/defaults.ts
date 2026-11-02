// Every setting's default, in one pure module the server's constants and the
// settings UI both import, so the two can't disagree (lib/settings/defaults.test).
// Context sizes are in tokens; 0 is off.

export const SETTING_DEFAULTS = {
  fresh: {
    orchestratorTokens: 200_000,
    taskTokens: 0,
    compactTokens: 150_000,
    autoCompactTokens: 300_000,
    interactiveAutoCompactTokens: 300_000,
  },
  // What a switch turns on with when the default is off.
  freshOnValue: 200_000,
  stallMinutes: 8,
  awayWindowMinutes: 60,
  // Off by default; what the switch turns on with.
  taskLimitOn: 3,
  sweepDays: 7,
} as const;

export type FreshKey = keyof typeof SETTING_DEFAULTS.fresh;

export function freshOnValue(key: FreshKey): number {
  const d = SETTING_DEFAULTS.fresh[key];
  return d > 0 ? d : SETTING_DEFAULTS.freshOnValue;
}
