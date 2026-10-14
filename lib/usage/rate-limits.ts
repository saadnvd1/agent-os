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
// per-window object. Anything else gives none. An event's top-level reading
// is only there when a threshold was crossed, while its `unifiedWindows`
// (read from the same response headers) carries both windows every time, so
// that one wins for a window both name.
export function parseRateLimit(info: unknown): Reading[] {
  if (!info || typeof info !== "object") return [];
  const i = info as Record<string, unknown>;
  const out = new Map<LimitWindow, Reading>();
  const status = typeof i.status === "string" ? i.status : null;
  const eventReading = (
    window: LimitWindow,
    fraction: unknown,
    resetsAt: unknown
  ) => {
    const raw = num(fraction);
    if (raw === null) return;
    const reset = num(resetsAt);
    out.set(window, {
      window,
      utilization: eventPercent(raw),
      raw,
      resetsAt: reset === null ? null : reset * 1000,
      status,
    });
  };
  const type = i.rateLimitType;
  if (type === "five_hour" || type === "seven_day")
    eventReading(type, i.utilization, i.resetsAt);
  const unified = i.unifiedWindows as Record<string, unknown> | undefined;
  for (const w of WINDOWS) {
    const o = unified?.[w] as Record<string, unknown> | null | undefined;
    if (o && typeof o === "object") eventReading(w, o.utilization, o.resetsAt);
  }
  for (const w of WINDOWS) {
    const o = i[w] as Record<string, unknown> | null | undefined;
    const u = o && num(o.utilization);
    if (!o || u === null || u === undefined) continue;
    const reset =
      typeof o.resets_at === "string" ? Date.parse(o.resets_at) : NaN;
    out.set(w, {
      window: w,
      utilization: u,
      raw: u,
      resetsAt: Number.isFinite(reset) ? reset : null,
      status,
    });
  }
  return [...out.values()];
}

// An unchanged reading refreshes the last row's time at most this often, so
// the newest row's `at` is when the value was last seen, not when it moved.
const REFRESH_MS = 60_000;

// Stores a reading only when it differs from that window's last, so a busy
// day adds a handful of rows, not one per response. A reading that hasn't
// moved only touches the last row's time. Returns the rows added.
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
        `SELECT id, at, utilization, resets_at, status FROM rate_limit_readings
         WHERE window = ? ORDER BY id DESC LIMIT 1`
      )
      .get(r.window) as
      | {
          id: number;
          at: number;
          utilization: number;
          resets_at: number | null;
          status: string | null;
        }
      | undefined;
    if (
      last &&
      last.utilization === r.utilization &&
      last.resets_at === r.resetsAt &&
      last.status === r.status
    ) {
      if (at - last.at >= REFRESH_MS)
        db.prepare(`UPDATE rate_limit_readings SET at = ? WHERE id = ?`).run(
          at,
          last.id
        );
      continue;
    }
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

// A window's readings in its current reset period over the hour up to the
// newest, oldest first as [epoch seconds, percent]: the series a burn rate
// is fitted to. Empty when there are none.
export function windowSamples(
  window: LimitWindow,
  spanMs = 3_600_000
): { resetsAt: number | null; samples: [number, number][] } {
  const newest = lastReading(window);
  if (!newest) return { resetsAt: null, samples: [] };
  const rows = db
    .prepare(
      `SELECT at, utilization FROM rate_limit_readings
       WHERE window = ? AND resets_at IS ? AND at >= ? ORDER BY at, id`
    )
    .all(window, newest.resetsAt, newest.at - spanMs) as {
    at: number;
    utilization: number;
  }[];
  return {
    resetsAt: newest.resetsAt,
    samples: rows.map((r) => [r.at / 1000, r.utilization]),
  };
}

// When any agent call was last recorded.
export function lastAgentActivity(): number | null {
  const r = db.prepare(`SELECT MAX(at) AS at FROM usage_calls`).get() as {
    at: number | null;
  };
  return r.at;
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
