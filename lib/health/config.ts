// The thresholds, all editable in Settings → Health. A setting holds a
// number as text under health.<name>; anything missing or invalid is the
// default, so a bad edit can't turn a check off by accident.

import { getSetting, putSetting } from "../settings-store";

export const HEALTH_DEFAULTS = {
  loadRedMinutes: 10,
  queueHeldMinutes: 60,
  bgQuietMinutes: 20,
  pieceDupOverlap: 0.4,
  restartsMax: 2,
  restartsWindowMinutes: 60,
  ciSlowFallbackMinutes: 20,
  armedStuckMinutes: 120,
  serverErrorsMin: 20,
  serverErrorsFactor: 5,
  // An environment failure reaches the orchestrator when this many sessions
  // hit one class inside the window, or when it returns after the quiet days.
  envBurstSessions: 3,
  envBurstHours: 24,
  envQuietDays: 7,
  // The watchers stop waking past this share of the 5-hour usage window.
  wakeUsageCeilingPct: 90,
  // 0 turns the watchers off: anomalies still open and reach the chat.
  watchersOn: 1,
} as const;

export type HealthKey = keyof typeof HEALTH_DEFAULTS;
export type HealthConfig = Record<HealthKey, number>;

export const HEALTH_LABELS: Record<HealthKey, string> = {
  loadRedMinutes: "Machine load red for (minutes)",
  queueHeldMinutes: "Queued task held for (minutes)",
  bgQuietMinutes: "Background job quiet for (minutes)",
  pieceDupOverlap: "Plan piece matches merged work (0 to 1 overlap)",
  restartsMax: "Server restarts allowed per window",
  restartsWindowMinutes: "Restart window (minutes)",
  ciSlowFallbackMinutes: "CI pending, when no history yet (minutes)",
  armedStuckMinutes: "PR armed without merging for (minutes)",
  serverErrorsMin: "Server errors per 10 minutes, at least",
  serverErrorsFactor: "Server errors, times the usual rate",
  envBurstSessions: "Environment failure: sessions in the window to alert",
  envBurstHours: "Environment failure window (hours)",
  envQuietDays: "Environment failure back after quiet for (days)",
  wakeUsageCeilingPct: "Stop waking watchers above usage (%)",
  watchersOn: "Watchers on (1) or off (0)",
};

const settingKey = (k: HealthKey) => `health.${k}`;

export function healthConfig(
  read: (key: string) => string | null = getSetting
): HealthConfig {
  const out = {} as HealthConfig;
  for (const k of Object.keys(HEALTH_DEFAULTS) as HealthKey[]) {
    const raw = read(settingKey(k));
    const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
    out[k] = Number.isFinite(n) && n >= 0 ? n : HEALTH_DEFAULTS[k];
  }
  return out;
}

// Stores a patch; null puts the default back. Returns what it refused.
export function setHealthConfig(patch: Record<string, unknown>): {
  errors: string[];
} {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in HEALTH_DEFAULTS)) {
      errors.push(`Unknown setting ${k}`);
      continue;
    }
    const key = k as HealthKey;
    if (v === null) {
      putSetting(settingKey(key), null);
      continue;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) {
      errors.push(`${HEALTH_LABELS[key]} must be a number, 0 or more`);
      continue;
    }
    putSetting(settingKey(key), String(n));
  }
  return { errors };
}
