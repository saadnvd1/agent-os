/**
 * Five-field cron (minute hour day-of-month month day-of-week) evaluated in a
 * time zone's wall clock. Runs are found by walking local dates and the
 * matching hours and minutes on each, then turning that wall time into an
 * instant. Across DST that means:
 *  - a wall time the clocks skip (2:30 on spring-forward day) runs once, an
 *    hour on (3:30), the way JavaScript reads it;
 *  - a wall time that happens twice (1:30 on fall-back day) runs once, the
 *    first time.
 */

export const DEFAULT_TIMEZONE = "America/Chicago";

export interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  // Vixie cron: restricting both day fields means either may match.
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const DAYS = "sun mon tue wed thu fri sat".split(" ");

function field(
  text: string,
  min: number,
  max: number,
  names: string[] = [],
  nameBase = 0
): Set<number> {
  const out = new Set<number>();
  const value = (s: string) => {
    const named = names.indexOf(s.toLowerCase());
    const n = named >= 0 ? named + nameBase : Number(s);
    if (!/^\d+$/.test(s) && named < 0) throw new Error(`"${s}" isn't a value`);
    if (n < min || n > max) throw new Error(`${s} is outside ${min}-${max}`);
    return n;
  };
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1)
      throw new Error(`"${part}" has a bad step`);
    let lo: number;
    let hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) {
      const [a, b] = range.split("-");
      [lo, hi] = [value(a), value(b)];
      if (lo > hi) throw new Error(`"${range}" runs backwards`);
    } else {
      lo = value(range);
      hi = stepText === undefined ? lo : max;
    }
    for (let n = lo; n <= hi; n += step) out.add(n);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5)
    throw new Error(
      "A cron expression has 5 fields: min hour day month weekday"
    );
  const [mi, h, dom, mon, dow] = parts;
  const weekdays = field(dow, 0, 7, DAYS);
  if (weekdays.delete(7)) weekdays.add(0);
  return {
    minutes: field(mi, 0, 59),
    hours: field(h, 0, 23),
    days: field(dom, 1, 31),
    months: field(mon, 1, 12, MONTHS, 1),
    weekdays,
    daysRestricted: dom !== "*",
    weekdaysRestricted: dow !== "*",
  };
}

export function cronError(expr: string): string | null {
  try {
    parseCron(expr);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function wall(ms: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(
    f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)])
  );
  return {
    y: p.year,
    m: p.month,
    d: p.day,
    h: p.hour,
    mi: p.minute,
    s: p.second,
  };
}

// How far the zone's clock is ahead of UTC at this instant.
function offsetAt(ms: number, tz: string): number {
  const w = wall(ms, tz);
  return (
    Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000
  );
}

// The instant a wall time happens: the first one when it happens twice, and
// shifted by the jump when the clocks skip it.
export function wallToInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  tz: string
): number {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  const candidates = new Set<number>();
  for (const probe of [asUtc - 864e5 / 2, asUtc, asUtc + 864e5 / 2])
    candidates.add(asUtc - offsetAt(probe, tz));
  const matching = [...candidates]
    .filter((t) => {
      const w = wall(t, tz);
      return w.y === y && w.m === m && w.d === d && w.h === h && w.mi === mi;
    })
    .sort((a, b) => a - b);
  if (matching.length) return matching[0];
  // Skipped: read it with the offset from before the jump.
  return asUtc - offsetAt(asUtc - 864e5 / 2, tz);
}

function dayMatches(cron: Cron, y: number, m: number, d: number): boolean {
  if (!cron.months.has(m)) return false;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dom = cron.days.has(d);
  const wd = cron.weekdays.has(dow);
  if (cron.daysRestricted && cron.weekdaysRestricted) return dom || wd;
  return dom && wd;
}

const sorted = (s: Set<number>, desc: boolean) =>
  [...s].sort((a, b) => (desc ? b - a : a - b));

// Up to five years of days before giving up (Feb 30 never comes).
const MAX_DAYS = 366 * 5;

function search(
  cron: Cron,
  tz: string,
  from: number,
  forward: boolean
): number | null {
  const start = wall(from, tz);
  const hours = sorted(cron.hours, !forward);
  const minutes = sorted(cron.minutes, !forward);
  for (let i = 0; i <= MAX_DAYS; i++) {
    const date = new Date(
      Date.UTC(start.y, start.m - 1, start.d + (forward ? i : -i))
    );
    const [y, m, d] = [
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    ];
    if (!dayMatches(cron, y, m, d)) continue;
    const midnight = Date.UTC(y, m - 1, d);
    const offset = offsetAt(midnight - 14 * 36e5, tz);
    if (offset === offsetAt(midnight + 38 * 36e5, tz)) {
      // No clock change today: wall times map straight to instants, in order.
      for (const h of hours)
        for (const mi of minutes) {
          const t = Date.UTC(y, m - 1, d, h, mi) - offset;
          if (forward ? t > from : t <= from) return t;
        }
      continue;
    }
    // Skipped and doubled wall times can reorder instants within a day.
    const hits: number[] = [];
    for (const h of hours)
      for (const mi of minutes) {
        const t = wallToInstant(y, m, d, h, mi, tz);
        if (forward ? t > from : t <= from) hits.push(t);
      }
    if (hits.length) return forward ? Math.min(...hits) : Math.max(...hits);
  }
  return null;
}

// The first run strictly after `from`.
export function nextRun(
  expr: string | Cron,
  from: number,
  tz = DEFAULT_TIMEZONE
): number | null {
  const cron = typeof expr === "string" ? parseCron(expr) : expr;
  return search(cron, tz, from, true);
}

// The latest run at or before `at`.
export function prevRun(
  expr: string | Cron,
  at: number,
  tz = DEFAULT_TIMEZONE
): number | null {
  const cron = typeof expr === "string" ? parseCron(expr) : expr;
  return search(cron, tz, at, false);
}

export function nextRuns(
  expr: string,
  from: number,
  count: number,
  tz = DEFAULT_TIMEZONE
): number[] {
  const cron = parseCron(expr);
  const out: number[] = [];
  let t = from;
  while (out.length < count) {
    const next = nextRun(cron, t, tz);
    if (next === null) break;
    out.push(next);
    t = next;
  }
  return out;
}

// "Tue, Oct 7, 9:00 AM" in the schedule's zone.
export function formatRunTime(ms: number, tz = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}

export type PresetKind = "hourly" | "daily" | "weekdays" | "weekly";

export interface Preset {
  kind: PresetKind;
  // 0-59; for hourly, the minute past each hour.
  minute: number;
  hour: number;
  // 0 = Sunday, for weekly.
  weekday: number;
}

export function presetCron(p: Preset): string {
  switch (p.kind) {
    case "hourly":
      return `${p.minute} * * * *`;
    case "daily":
      return `${p.minute} ${p.hour} * * *`;
    case "weekdays":
      return `${p.minute} ${p.hour} * * 1-5`;
    case "weekly":
      return `${p.minute} ${p.hour} * * ${p.weekday}`;
  }
}

// The preset a cron expression was made from, or null for anything else.
export function cronPreset(expr: string): Preset | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || !/^\d+$/.test(parts[0])) return null;
  const [mi, h, dom, mon, dow] = parts;
  const minute = Number(mi);
  if (minute > 59 || dom !== "*" || mon !== "*") return null;
  if (h === "*" && dow === "*")
    return { kind: "hourly", minute, hour: 9, weekday: 1 };
  if (!/^\d+$/.test(h) || Number(h) > 23) return null;
  const hour = Number(h);
  if (dow === "*") return { kind: "daily", minute, hour, weekday: 1 };
  if (dow === "1-5") return { kind: "weekdays", minute, hour, weekday: 1 };
  if (/^[0-6]$/.test(dow))
    return { kind: "weekly", minute, hour, weekday: Number(dow) };
  return null;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function clock12(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// "Weekdays at 9:00 AM", or the expression itself.
export function describeCron(expr: string): string {
  if (expr.trim() === "* * * * *") return "Every minute";
  const p = cronPreset(expr);
  if (!p) return expr.trim();
  const at = clock12(p.hour, p.minute);
  switch (p.kind) {
    case "hourly":
      return p.minute === 0
        ? "Every hour"
        : `Every hour at :${String(p.minute).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${at}`;
    case "weekdays":
      return `Weekdays at ${at}`;
    case "weekly":
      return `${DAY_NAMES[p.weekday]}s at ${at}`;
  }
}
