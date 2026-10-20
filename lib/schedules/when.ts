// One parser for "when" so the API, the CLI and the orchestrator's remind_me
// all read a time the same way: an ISO timestamp, "tomorrow 10am", "in 2h".

import { DEFAULT_TIMEZONE, wall, wallToInstant } from "./cron";

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const dayIndex = (word: string): number =>
  DAYS.findIndex((d) => d === word || d.slice(0, 3) === word);

const bad = (text: string) =>
  new Error(
    `Can't read "${text}" as a time: try "tomorrow 10am", "in 2h" or 2026-10-12T10:00`
  );

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function duration(text: string): number | null {
  let total = 0;
  const rest = text.replace(
    /(\d+(?:\.\d+)?|an?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/g,
    (_, n: string, unit: string) => {
      total += (/^an?$/.test(n) ? 1 : Number(n)) * UNIT_MS[unit[0]];
      return "";
    }
  );
  return total > 0 && /^(\s|,|and)*$/.test(rest) ? total : null;
}

function clock(text: string): { h: number; mi: number } | null {
  if (text === "noon") return { h: 12, mi: 0 };
  if (text === "midnight") return { h: 0, mi: 0 };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!m) return null;
  const mi = m[2] ? Number(m[2]) : 0;
  let h = Number(m[1]);
  if (mi > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  } else if (!m[2] || h > 23) {
    // "tomorrow 10" is ambiguous; 24-hour times need their minutes.
    return null;
  }
  return { h, mi };
}

const CLOCK = String.raw`noon|midnight|\d{1,2}(?::\d{2})?\s*(?:am|pm)?`;
const DAY = String.raw`(?:next\s+)?(?:today|tomorrow|tmrw|[a-z]{3,9})`;
const DAY_FIRST = new RegExp(`^(${DAY})\\s+(?:at\\s+)?(${CLOCK})$`);
const CLOCK_FIRST = new RegExp(`^(?:at\\s+)?(${CLOCK})(?:\\s+(${DAY}))?$`);

function onDay(
  word: string | undefined,
  at: { h: number; mi: number },
  now: number,
  tz: string
): number | null {
  const today = wall(now, tz);
  const instantIn = (days: number) => {
    const d = new Date(Date.UTC(today.y, today.m - 1, today.d + days));
    return wallToInstant(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      at.h,
      at.mi,
      tz
    );
  };
  const w = word?.replace(/^next\s+/, "");
  if (!w) return instantIn(0) > now ? instantIn(0) : instantIn(1);
  if (w === "today") return instantIn(0);
  if (w === "tomorrow" || w === "tmrw") return instantIn(1);
  const dow = dayIndex(w);
  if (dow < 0) return null;
  const todayDow = new Date(
    Date.UTC(today.y, today.m - 1, today.d)
  ).getUTCDay();
  const delta = (dow - todayDow + 7) % 7;
  return delta === 0 && instantIn(0) <= now ? instantIn(7) : instantIn(delta);
}

// The instant (epoch ms) the text names. An offset or Z is absolute; any other
// wall time reads in `tz`; "in 2h" is an exact duration from `now`.
export function parseWhen(
  text: string,
  tz = DEFAULT_TIMEZONE,
  now = Date.now()
): number {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) throw bad(text);

  const abs =
    /^(\d{4}-\d{2}-\d{2})[t ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(z|[+-]\d{2}:?\d{2})$/.exec(
      t
    );
  if (abs) {
    const zone = abs[3] === "z" ? "Z" : abs[3].replace(/^([+-]\d{2}):?/, "$1:");
    const ms = Date.parse(`${abs[1]}T${abs[2]}${zone}`);
    if (Number.isNaN(ms)) throw bad(text);
    return ms;
  }

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(
      t
    );
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const h = iso[4] === undefined ? 9 : Number(iso[4]);
    const mi = iso[5] === undefined ? 0 : Number(iso[5]);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (
      check.getUTCMonth() !== m - 1 ||
      check.getUTCDate() !== d ||
      h > 23 ||
      mi > 59
    )
      throw bad(text);
    return wallToInstant(y, m, d, h, mi, tz);
  }

  const inside = /^in (.+)$/.exec(t);
  if (inside) {
    const ms = duration(inside[1]);
    if (ms === null) throw bad(text);
    return now + ms;
  }

  const first = DAY_FIRST.exec(t);
  const second = first ? null : CLOCK_FIRST.exec(t);
  const at = clock(first?.[2] ?? second?.[1] ?? "");
  if (at) {
    const instant = onDay(first?.[1] ?? second?.[2], at, now, tz);
    if (instant !== null) return instant;
  }
  throw bad(text);
}

// "in 17h", "in 5m", "3h ago".
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const mins = Math.floor(Math.abs(diff) / 60_000);
  const span =
    mins < 1
      ? null
      : mins < 60
        ? `${mins}m`
        : mins < 24 * 60
          ? `${Math.floor(mins / 60)}h`
          : `${Math.floor(mins / (24 * 60))}d`;
  if (!span) return diff >= 0 ? "in under a minute" : "just now";
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}
