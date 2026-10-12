/**
 * The ratchet's thresholds, kept in the settings table so they can change
 * without a deploy. Each falls back to its default for a missing or invalid
 * value.
 */

import { db } from "../db";

export const USAGE_KEYS = {
  costPct: "usage.alert_cost_pct",
  cleanPoints: "usage.alert_clean_points",
  baselineDays: "usage.baseline_days",
  avgDays: "usage.avg_days",
  minMerges: "usage.alert_min_merges",
  weeklyStaleHours: "usage.weekly_stale_hours",
} as const;

export interface UsageConfig {
  // Alert when the 3-day cost per merged PR is this many percent over baseline.
  costPct: number;
  // Alert when the clean-merge rate is this many points under baseline.
  cleanPoints: number;
  baselineDays: number;
  avgDays: number;
  // Fewer merges than this over the average window: too little to judge.
  minMerges: number;
  weeklyStaleHours: number;
}

export const USAGE_DEFAULTS: UsageConfig = {
  costPct: 15,
  cleanPoints: 10,
  baselineDays: 7,
  avgDays: 3,
  minMerges: 3,
  weeklyStaleHours: 6,
};

const DAY_COUNTS = new Set<keyof UsageConfig>(["baselineDays", "avgDays"]);

export function readUsageConfig(): UsageConfig {
  const out: UsageConfig = { ...USAGE_DEFAULTS };
  for (const [name, key] of Object.entries(USAGE_KEYS)) {
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    const v = row ? Number(row.value) : NaN;
    const key2 = name as keyof UsageConfig;
    // A day count is a whole number of days, at least one.
    const ok = DAY_COUNTS.has(key2)
      ? Number.isInteger(v) && v >= 1
      : Number.isFinite(v) && v >= 0;
    if (ok) out[key2] = v;
  }
  return out;
}
