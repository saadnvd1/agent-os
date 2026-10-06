/**
 * Where the account's 5-hour usage window stands, ported from dispatch's
 * `account_limit`. The statusline in ~/dev/dev-settings samples the window's
 * used percentage into limits.json, keyed on when it resets; this only reads
 * it. A sample that's a little stale or about a window that already reset
 * says nothing about the burn rate, so the projection is skipped. But a
 * file that's missing, unreadable or not sampled for 15 minutes means the
 * window can't be checked at all, and then starts are refused: the brake
 * fails closed.
 */

import fs from "fs";
import os from "os";
import path from "path";

export const LIMITS_FILE =
  process.env.AGENTOS_LIMITS_FILE ??
  path.join(os.homedir(), ".claude", ".context-cost", "limits.json");

// A sample older than this says nothing about now (seconds).
const STALE_AFTER = 600;
// Observed seconds and points of movement before a burn rate means anything.
const MIN_SPAN = 300;
const MIN_MOVE = 2;

export interface UsageWindow {
  pct: number;
  resetsIn: number;
  burnPerMin: number | null;
  // Seconds until it runs out, only when that's before it resets.
  capsIn: number | null;
}

interface LimitsFile {
  window?: unknown;
  samples?: unknown;
}

export function usageWindow(
  state: LimitsFile | null,
  nowSec = Date.now() / 1000
): UsageWindow | null {
  const samples = Array.isArray(state?.samples)
    ? (state.samples as unknown[][])
    : [];
  const resetsAt = state?.window;
  if (!samples.length || typeof resetsAt !== "number" || resetsAt <= nowSec)
    return null;
  const [newestAt, newestPct] = samples[samples.length - 1].map(Number);
  if (!Number.isFinite(newestAt) || !Number.isFinite(newestPct)) return null;
  if (Math.abs(nowSec - newestAt) > STALE_AFTER) return null;
  const pct = Math.trunc(newestPct);

  let burnPerMin: number | null = null;
  let capsIn: number | null = null;
  if (samples.length >= 2) {
    const span = newestAt - Number(samples[0][0]);
    const move = newestPct - Number(samples[0][1]);
    if (span >= MIN_SPAN && move >= MIN_MOVE) {
      burnPerMin = move / (span / 60);
      const runsOut = ((100 - pct) / burnPerMin) * 60;
      if (nowSec + runsOut < resetsAt) capsIn = Math.trunc(runsOut);
    }
  }
  return {
    pct,
    resetsIn: Math.trunc(resetsAt - nowSec),
    burnPerMin: burnPerMin === null ? null : Math.round(burnPerMin * 100) / 100,
    capsIn,
  };
}

// Past this the window can't be vouched for at all (seconds).
const UNKNOWN_AFTER = 15 * 60;

export type UsageState = { window: UsageWindow | null } | { unknown: string };

export function readUsage(
  file = LIMITS_FILE,
  nowSec = Date.now() / 1000
): UsageState {
  let state: LimitsFile;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as LimitsFile;
  } catch {
    return { unknown: `the usage window can't be read (${file})` };
  }
  const samples = Array.isArray(state.samples)
    ? (state.samples as unknown[][])
    : [];
  const newest = Number(samples.at(-1)?.[0]);
  if (!Number.isFinite(newest))
    return { unknown: "the usage window has no samples" };
  const age = nowSec - newest;
  if (age > UNKNOWN_AFTER)
    return {
      unknown: `the usage window was last sampled ${minutes(age)} ago, so it can't be checked`,
    };
  return { window: usageWindow(state, nowSec) };
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}

// Why the window refuses a new start, or null.
export function windowRefusal(
  state: UsageState | UsageWindow | null
): string | null {
  if (state && "unknown" in state) return state.unknown;
  const w = state && "window" in state ? state.window : state;
  if (!w) return null;
  if (w.pct >= 100)
    return `the usage window is used up; it resets in ${minutes(w.resetsIn)}`;
  if (w.capsIn !== null)
    return `the usage window is ${w.pct}% used and at this rate runs out in ${minutes(w.capsIn)}, before it resets in ${minutes(w.resetsIn)}`;
  return null;
}
