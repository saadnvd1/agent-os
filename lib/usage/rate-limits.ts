/**
 * The account's limit windows as Claude Code reports them: its
 * rate_limit_event carries what the anthropic-ratelimit-unified-* headers
 * said on a response, for the window that matters most at that moment. Each
 * reading is kept with its time; between readings the weekly figure is an
 * estimate from recorded usage, and labelled as one.
 */

import { db } from "../db";
import { weighted, type TokenRow } from "./weights";
import { readUsageConfig } from "./config";

export type LimitWindow = "five_hour" | "seven_day";

export interface Reading {
  window: LimitWindow;
  // Percent used, 0-100.
  utilization: number;
  raw: number;
  // Epoch ms.
  resetsAt: number | null;
  status: string | null;
}

const WINDOWS: LimitWindow[] = ["five_hour", "seven_day"];
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

// A rate_limit_event carries what the headers said: utilization as a
// fraction (0.42) and the reset in epoch seconds. A plan's per-window object
// carries a percent (42) and an ISO time. Each source has one unit.
const eventPercent = (fraction: number) => fraction * 100;

// Readings in what the CLI emits: a rate_limit_event's info, or a plan's
// per-window object. Anything else gives none.
export function parseRateLimit(info: unknown): Reading[] {
  if (!info || typeof info !== "object") return [];
  const i = info as Record<string, unknown>;
  const out: Reading[] = [];
  const status = typeof i.status === "string" ? i.status : null;
  const type = i.rateLimitType;
  const raw = num(i.utilization);
  if ((type === "five_hour" || type === "seven_day") && raw !== null) {
    const reset = num(i.resetsAt);
    out.push({
      window: type,
      utilization: eventPercent(raw),
      raw,
      resetsAt: reset === null ? null : reset * 1000,
      status,
    });
  }
  for (const w of WINDOWS) {
    const o = i[w] as Record<string, unknown> | null | undefined;
    const u = o && num(o.utilization);
    if (!o || u === null || u === undefined) continue;
    const reset =
      typeof o.resets_at === "string" ? Date.parse(o.resets_at) : NaN;
    out.push({
      window: w,
      utilization: u,
      raw: u,
      resetsAt: Number.isFinite(reset) ? reset : null,
      status,
    });
  }
  return out;
}

// Stores a reading only when it differs from that window's last, so a busy
// day adds a handful of rows, not one per response.
export function recordReadings(
  readings: Reading[],
  source: string,
  sessionId: string | null = null,
  at = Date.now()
): number {
  let added = 0;
  for (const r of readings) {
    const last = db
      .prepare(
        `SELECT utilization, resets_at, status FROM rate_limit_readings
         WHERE window = ? ORDER BY id DESC LIMIT 1`
      )
      .get(r.window) as
      | { utilization: number; resets_at: number | null; status: string | null }
      | undefined;
    if (
      last &&
      last.utilization === r.utilization &&
      last.resets_at === r.resetsAt &&
      last.status === r.status
    )
      continue;
    db.prepare(
      `INSERT INTO rate_limit_readings (at, window, utilization, raw, resets_at, status, session_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      at,
      r.window,
      r.utilization,
      r.raw,
      r.resetsAt,
      r.status,
      sessionId,
      source
    );
    added++;
  }
  return added;
}

export interface WindowReading {
  pct: number;
  resetsAt: number | null;
  // When it was read (or, for an estimate, worked out).
  at: number;
  estimated: boolean;
}

export function lastReading(
  window: LimitWindow,
  before = Number.MAX_SAFE_INTEGER
): { at: number; utilization: number; resetsAt: number | null } | null {
  const r = db
    .prepare(
      `SELECT at, utilization, resets_at FROM rate_limit_readings
       WHERE window = ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 1`
    )
    .get(window, before) as
    | { at: number; utilization: number; resets_at: number | null }
    | undefined;
  return r
    ? { at: r.at, utilization: r.utilization, resetsAt: r.resets_at }
    : null;
}

const WEEK = 7 * 24 * 3600 * 1000;

export function weightedBetween(from: number, to: number): number {
  const rows = db
    .prepare(
      `SELECT model, provider, input_tokens, cache_read_tokens, cache_write_5m_tokens,
         cache_write_1h_tokens, output_tokens FROM usage_calls WHERE at > ? AND at <= ?`
    )
    .all(from, to) as TokenRow[];
  let t = 0;
  for (const r of rows) t += weighted(r);
  return t;
}

// The weekly percent now, worked out from the last real reading: the usage
// recorded in the week up to that reading stands for its percent, so the
// week up to now stands for this one. Null before any reading.
export function estimateWeekly(now: number): WindowReading | null {
  const last = lastReading("seven_day", now);
  if (!last || last.utilization <= 0) return null;
  const then = weightedBetween(last.at - WEEK, last.at);
  if (then <= 0) return null;
  const pct = (weightedBetween(now - WEEK, now) / then) * last.utilization;
  return {
    pct: Math.round(pct * 10) / 10,
    resetsAt: last.resetsAt,
    at: now,
    estimated: true,
  };
}

// The window from a reading when it's fresh enough, else (weekly only) the
// estimate, labelled.
export function currentWindow(
  window: LimitWindow,
  now = Date.now()
): WindowReading | null {
  const last = lastReading(window, now);
  const maxAge =
    window === "five_hour"
      ? 30 * 60_000
      : readUsageConfig().weeklyStaleHours * 3_600_000;
  // A reading from before its window reset describes the old window.
  const live =
    last && now - last.at <= maxAge && (!last.resetsAt || last.resetsAt > now);
  if (last && live)
    return {
      pct: last.utilization,
      resetsAt: last.resetsAt,
      at: last.at,
      estimated: false,
    };
  if (window === "seven_day") return estimateWeekly(now);
  return null;
}
