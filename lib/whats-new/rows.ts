import type { Entry } from "./schema";

export type Row =
  | { type: "heading"; key: string; label: string }
  | { type: "day"; key: string; label: string }
  | { type: "entry"; key: string; entry: Entry }
  | { type: "divider"; key: string; label: string };

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

const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Today", "Yesterday" or "Oct 27" (with the year when it isn't this one). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  if (iso === isoOf(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (iso === isoOf(y)) return "Yesterday";
  const d = day(iso);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear()
    ? base
    : `${base}, ${d.getFullYear()}`;
}

/**
 * Day headings with entries under them, newest first. When some entries are
 * newer than `seen`, a divider marks where the last visit ended.
 */
export function buildRows(
  entries: Entry[],
  seen: number | null,
  now: Date = new Date()
): Row[] {
  const rows: Row[] = [];
  const anyUnread = seen !== null && entries.some((e) => e.id > seen);
  let current: string | null = null;
  let divided = false;
  for (const e of entries) {
    if (anyUnread && !divided && e.id <= seen!) {
      divided = true;
      current = null;
      rows.push({
        type: "divider",
        key: "divider",
        label: `You last looked ${dayLabel(e.date, now)}`,
      });
    }
    if (e.date !== current) {
      current = e.date;
      rows.push({
        type: "day",
        key: `day-${e.date}-${rows.length}`,
        label: dayLabel(e.date, now),
      });
    }
    rows.push({ type: "entry", key: `e-${e.id}`, entry: e });
  }
  return rows;
}
