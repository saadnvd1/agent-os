// The thresholds, all editable in Settings → Health. A setting holds a
// number as text under health.<name>; anything missing or invalid is the
// default, so a bad edit can't turn a check off by accident.

import { getSetting, putSetting } from "../settings-store";

export const HEALTH_DEFAULTS = {
  loadRedMinutes: 10,
  queueHeldMinutes: 60,
  bgQuietMinutes: 20,
  portWaitMinutes: 10,
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

export interface HealthMeta {
  label: string;
  unit?: string;
  min: number;
  max?: number;
  integer?: boolean;
  // A 1/0 value shown as a switch.
  switch?: boolean;
}

// How each threshold reads in Settings: the server owns it, so a new
// threshold needs no client change.
export const HEALTH_META: Record<HealthKey, HealthMeta> = {
  loadRedMinutes: { label: "Machine load red for", unit: "min", min: 1 },
  queueHeldMinutes: { label: "Queued task held for", unit: "min", min: 1 },
  bgQuietMinutes: { label: "Background job quiet for", unit: "min", min: 1 },
  portWaitMinutes: {
    label: "Waiting on a port someone else holds for",
    unit: "min",
    min: 1,
  },
  pieceDupOverlap: {
    label: "Plan piece matches merged work",
    min: 0,
    max: 1,
    integer: false,
  },
  restartsMax: { label: "Server restarts allowed per window", min: 1 },
  restartsWindowMinutes: { label: "Restart window", unit: "min", min: 1 },
  ciSlowFallbackMinutes: {
    label: "CI pending, when no history yet",
    unit: "min",
    min: 1,
  },
  armedStuckMinutes: {
    label: "PR armed without merging for",
    unit: "min",
    min: 1,
  },
  serverErrorsMin: {
    label: "Server errors per 10 minutes, at least",
    min: 1,
  },
  serverErrorsFactor: {
    label: "Server errors, times the usual rate",
    unit: "×",
    min: 1,
    integer: false,
  },
  envBurstSessions: {
    label: "Environment failure: sessions in the window to alert",
    min: 1,
  },
  envBurstHours: { label: "Environment failure window", unit: "hours", min: 1 },
  envQuietDays: {
    label: "Environment failure back after quiet for",
    unit: "days",
    min: 1,
  },
  wakeUsageCeilingPct: {
    label: "Stop waking watchers above usage",
    unit: "%",
    min: 1,
    max: 100,
  },
  watchersOn: { label: "Watchers", min: 0, max: 1, switch: true },
};

export const HEALTH_LABELS = Object.fromEntries(
  Object.entries(HEALTH_META).map(([k, m]) => [k, m.label])
) as Record<HealthKey, string>;

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
