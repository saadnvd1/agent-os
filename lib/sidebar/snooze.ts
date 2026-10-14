// Snooze presets and how a wake time reads. The reader's own zone decides
// "9am", so this runs on their device. Client-safe.

export type SnoozePreset = "tomorrow" | "next-week";

export const SNOOZE_PRESETS: { key: SnoozePreset; label: string }[] = [
  { key: "tomorrow", label: "Tomorrow" },
  { key: "next-week", label: "Next week" },
];

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function wall(ms: number, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, Number(x.value)])
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

const offsetAt = (ms: number, timeZone: string) => {
  const w = wall(ms, timeZone);
  return (
    Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000
  );
};

// The instant a zone's wall clock reads the given date and hour; the offset
// is read again at the result so a DST change in between is honoured.
function zoned(y: number, m: number, d: number, h: number, timeZone: string) {
  const guess = Date.UTC(y, m - 1, d, h);
  let t = guess - offsetAt(guess, timeZone);
  t = guess - offsetAt(t, timeZone);
  return t;
}

// "Tomorrow" is 9am the next day; "Next week" is 9am next Monday (a Monday
// waits a full week, a Sunday waits a day).
export function snoozePreset(
  preset: SnoozePreset,
  now: Date = new Date(),
  timeZone: string = localZone()
): Date {
  const { y, m, d } = wall(now.getTime(), timeZone);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const ahead = preset === "tomorrow" ? 1 : (1 - weekday + 7) % 7 || 7;
  const target = new Date(Date.UTC(y, m - 1, d + ahead));
  return new Date(
    zoned(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      target.getUTCDate(),
      9,
      timeZone
    )
  );
}

const dayNumber = (ms: number, timeZone: string) => {
  const w = wall(ms, timeZone);
  return Math.round(Date.UTC(w.y, w.m - 1, w.d) / 86400000);
};

// "9 AM", "Tomorrow 9 AM", "Mon 9 AM", "Oct 20, 9 AM".
export function wakeLabel(
  ms: number,
  now: number = Date.now(),
  timeZone: string = localZone()
): string {
  const date = new Date(ms);
  const time = date
    .toLocaleTimeString("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(/\s/g, " ")
    .replace(":00", "");
  const days = dayNumber(ms, timeZone) - dayNumber(now, timeZone);
  if (days <= 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7)
    return `${date.toLocaleDateString("en-US", { timeZone, weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric" })}, ${time}`;
}

// How long a paused session stays paused: a set time, or until someone
// resumes it. "Tomorrow" is the same 9am as Snooze's.
export type PausePreset = "1h" | "2h" | "tomorrow" | "until-resumed";

export const PAUSE_PRESETS: { key: PausePreset; label: string }[] = [
  { key: "1h", label: "For 1 hour" },
  { key: "2h", label: "For 2 hours" },
  { key: "tomorrow", label: "Until tomorrow 9 AM" },
  { key: "until-resumed", label: "Until I resume" },
];

// The instant a pause ends; null: until resumed.
export function pauseUntil(
  preset: PausePreset,
  now: Date = new Date(),
  timeZone: string = localZone()
): Date | null {
  if (preset === "1h") return new Date(now.getTime() + 3_600_000);
  if (preset === "2h") return new Date(now.getTime() + 7_200_000);
  if (preset === "tomorrow") return snoozePreset("tomorrow", now, timeZone);
  return null;
}

export const isPausePreset = (v: unknown): v is PausePreset =>
  PAUSE_PRESETS.some((p) => p.key === v);
