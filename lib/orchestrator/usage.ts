/**
 * Where the account's 5-hour usage window stands, ported from dispatch's
 * `account_limit`. Two things sample it: AgentOS's own agents (every
 * rate-limit event a chat worker sees is stored in `rate_limit_readings`) and
 * the terminal statusline, which writes limits.json. This reads both and uses
 * whichever was sampled last, never mixing their samples. A sample that's a
 * little stale or about a window that already reset says nothing about the
 * burn rate, so the projection is skipped. Past 15 minutes without a sample
 * the window is unknown: that is said plainly, with the last value seen, and
 * a start is refused only when nothing was ever sampled or the last value was
 * near the cap and its window hasn't reset.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { lastAgentActivity, windowSamples } from "../usage/rate-limits";

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
// A start is refused on an unknown window only when it was this full.
const STALE_REFUSE_PCT = 90;

// What was last seen of the window, however long ago (seconds).
export interface LastSeen {
  pct: number;
  resetsAt: number | null;
  sampledAt: number;
}

export type UsageState =
  { window: UsageWindow | null } | { unknown: string; last?: LastSeen | null };

export interface Series {
  window: number | null;
  samples: [number, number][];
}

function readLimitsFile(file: string): LimitsFile | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LimitsFile;
  } catch {
    return null;
  }
}

function toSeries(state: LimitsFile | null): Series | null {
  const samples = Array.isArray(state?.samples)
    ? (state.samples as unknown[][])
        .map((s) => [Number(s[0]), Number(s[1])] as [number, number])
        .filter(([at, pct]) => Number.isFinite(at) && Number.isFinite(pct))
    : [];
  if (!samples.length) return null;
  return {
    window: typeof state?.window === "number" ? state.window : null,
    samples,
  };
}

function storedSeries(): Series | null {
  const { resetsAt, samples } = windowSamples("five_hour");
  return samples.length
    ? { window: resetsAt === null ? null : resetsAt / 1000, samples }
    : null;
}

// A ledger that can't be read is a source with nothing in it.
const quietly = <T>(read: () => T | null): T | null => {
  try {
    return read();
  } catch {
    return null;
  }
};

const clock = (sec: number, nowSec: number): string => {
  const d = new Date(sec * 1000);
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return d.toDateString() === new Date(nowSec * 1000).toDateString()
    ? time
    : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
};

// Why the window isn't known: nothing was ever sampled, no agent has run
// since the last sample, or agents ran without reporting it.
export function unknownText(
  sampledAt: number | null,
  activityAt: number | null,
  nowSec: number
): string {
  if (sampledAt === null)
    return "No agent has reported the usage window yet, so usage isn't sampled";
  if (activityAt === null || activityAt / 1000 <= sampledAt + 60)
    return `No agent has run since ${clock(sampledAt, nowSec)}, so usage isn't sampled`;
  return `Agents ran at ${clock(activityAt / 1000, nowSec)} but didn't report the usage window; it was last sampled at ${clock(sampledAt, nowSec)}`;
}

export function readUsage(
  file = LIMITS_FILE,
  nowSec = Date.now() / 1000,
  stored: () => Series | null = storedSeries,
  activity: () => number | null = lastAgentActivity
): UsageState {
  const newestAt = (s: Series) => s.samples[s.samples.length - 1][0];
  const sources = [toSeries(readLimitsFile(file)), quietly(stored)].filter(
    (s): s is Series => s !== null
  );
  const chosen = sources.sort((a, b) => newestAt(b) - newestAt(a))[0] ?? null;
  const sampledAt = chosen ? newestAt(chosen) : null;
  if (chosen && sampledAt !== null && nowSec - sampledAt <= UNKNOWN_AFTER)
    return { window: usageWindow(chosen, nowSec) };
  const activityAt = quietly(activity);
  const newest = chosen && chosen.samples[chosen.samples.length - 1];
  return {
    unknown: unknownText(sampledAt, activityAt, nowSec),
    last:
      chosen && newest && sampledAt !== null
        ? { pct: Math.trunc(newest[1]), resetsAt: chosen.window, sampledAt }
        : null,
  };
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}

// Why the window refuses a new start, or null. An unknown window refuses
// unless it was last seen low or its window has since reset: nothing is
// sampling, so the figure can't have moved, and the next start's own run
// samples it again.
export function windowRefusal(
  state: UsageState | UsageWindow | null,
  nowSec = Date.now() / 1000
): string | null {
  if (state && "unknown" in state) {
    const last = state.last;
    if (!last) return state.unknown;
    if (last.resetsAt !== null && last.resetsAt <= nowSec) return null;
    if (last.pct < STALE_REFUSE_PCT) return null;
    return `${state.unknown}; it was ${last.pct}% used when last seen${last.resetsAt === null ? "" : ` and resets at ${clock(last.resetsAt, nowSec)}`}`;
  }
  const w = state && "window" in state ? state.window : state;
  if (!w) return null;
  if (w.pct >= 100)
    return `the usage window is used up; it resets in ${minutes(w.resetsIn)}`;
  if (w.capsIn !== null)
    return `the usage window is ${w.pct}% used and at this rate runs out in ${minutes(w.capsIn)}, before it resets in ${minutes(w.resetsIn)}`;
  return null;
}
