// Which part of a chat a share covers. Pure, imports nothing outside itself,
// so the dialog and the server resolve a range the same way.

/** A range of messages by id, both ends included. */
export interface ShareRange {
  fromId: string;
  toId: string;
}

export interface RangeRow {
  id: string;
  type: string;
  createdAt?: number;
}

export type RangePreset = "last" | "last5" | "today" | "all";

export const PRESETS: { id: RangePreset; label: string }[] = [
  { id: "last", label: "Last exchange" },
  { id: "last5", label: "Last 5 exchanges" },
  { id: "today", label: "Today" },
  { id: "all", label: "Whole chat" },
];

export const EARLIER_NOT_SHARED = "Earlier messages not shared";
export const LATER_NOT_SHARED = "Later messages not shared";

export const DEFAULT_PRESET: RangePreset = "last";

/** Positions in `ids` that a range covers, or null when an end isn't there or they're backwards. A missing end means the chat's own start or end. */
export function windowOf(
  ids: string[],
  fromId?: string,
  toId?: string
): { start: number; end: number } | null {
  const start = fromId === undefined ? 0 : ids.indexOf(fromId);
  const end = toId === undefined ? ids.length - 1 : ids.indexOf(toId);
  if (start < 0 || end < 0 || start > end) return null;
  return { start, end };
}

/** Where each exchange begins: a user prompt. Rows before the first prompt are an exchange of their own. */
export function exchangeStarts(rows: RangeRow[]): number[] {
  const starts = rows.flatMap((r, i) => (r.type === "user" ? [i] : []));
  if (rows.length && starts[0] !== 0) starts.unshift(0);
  return starts;
}

const startOfDay = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/** The range a preset means, or null when it has nothing to pick (no messages today). */
export function presetRange(
  rows: RangeRow[],
  preset: RangePreset,
  now: Date
): ShareRange | null {
  if (!rows.length) return null;
  const last = rows[rows.length - 1].id;
  const starts = exchangeStarts(rows);
  let from: number;
  switch (preset) {
    case "last":
      from = starts[starts.length - 1];
      break;
    case "last5":
      from = starts[Math.max(0, starts.length - 5)];
      break;
    case "all":
      from = 0;
      break;
    case "today": {
      const day = startOfDay(now);
      const todays = rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => (r.createdAt ?? 0) >= day);
      if (!todays.length) return null;
      from = (todays.find(({ r }) => r.type === "user") ?? todays[0]).i;
      break;
    }
  }
  return { fromId: rows[from].id, toId: last };
}

/** The preset a range equals, or null for a custom one. */
export function activePreset(
  rows: RangeRow[],
  range: ShareRange | null,
  now: Date
): RangePreset | null {
  if (!range) return null;
  return (
    PRESETS.find((p) => {
      const r = presetRange(rows, p.id, now);
      return r && r.fromId === range.fromId && r.toId === range.toId;
    })?.id ?? null
  );
}

/** From a message to the latest one. */
export function rangeFromHere(rows: RangeRow[], id: string): ShareRange | null {
  return rows.some((r) => r.id === id)
    ? { fromId: id, toId: rows[rows.length - 1].id }
    : null;
}

/** A click sets the range to one message; shift-click stretches it from the anchor to the clicked one, either direction. */
export function clickRange(
  rows: RangeRow[],
  anchorId: string | null,
  clickedId: string,
  extend: boolean
): ShareRange {
  const a = extend && anchorId ? rows.findIndex((r) => r.id === anchorId) : -1;
  const b = rows.findIndex((r) => r.id === clickedId);
  if (a < 0 || b < 0) return { fromId: clickedId, toId: clickedId };
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return { fromId: rows[lo].id, toId: rows[hi].id };
}

/** Rows the range covers (all of them when there is none yet). */
export function inRange<T extends RangeRow>(
  rows: T[],
  range: ShareRange | null
): T[] {
  if (!range) return rows;
  const w = windowOf(
    rows.map((r) => r.id),
    range.fromId,
    range.toId
  );
  return w ? rows.slice(w.start, w.end + 1) : [];
}

const clock = (d: Date) => {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return { text: `${h % 12 || 12}:${m}`, ampm: h < 12 ? "AM" : "PM" };
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const dayLabel = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** "2:14–2:40 PM", "11:50 AM–12:10 PM", or with dates when it crosses a day. */
export function timeSpan(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  const ca = clock(a);
  const cb = clock(b);
  if (!sameDay(a, b))
    return `${dayLabel(a)}, ${ca.text} ${ca.ampm} – ${dayLabel(b)}, ${cb.text} ${cb.ampm}`;
  if (ca.text === cb.text && ca.ampm === cb.ampm)
    return `${ca.text} ${ca.ampm}`;
  return ca.ampm === cb.ampm
    ? `${ca.text}–${cb.text} ${cb.ampm}`
    : `${ca.text} ${ca.ampm}–${cb.text} ${cb.ampm}`;
}

/** "Sharing 6 of 120 messages · 2:14–2:40 PM". */
export function rangeSummary(total: number, shared: RangeRow[]): string {
  if (!shared.length) return "Nothing selected to share";
  const noun = total === 1 ? "message" : "messages";
  const times = shared
    .map((r) => r.createdAt)
    .filter((t): t is number => typeof t === "number" && t > 0);
  const base = `Sharing ${shared.length} of ${total} ${noun}`;
  return times.length
    ? `${base} · ${timeSpan(Math.min(...times), Math.max(...times))}`
    : base;
}
