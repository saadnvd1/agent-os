const clock = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// "until 4:30 PM", "until Sat 8:00 AM", or "until you're back".
export function awayUntil(expiresAt: string | null, now = new Date()): string {
  if (!expiresAt) return "until you're back";
  const d = new Date(expiresAt);
  const day =
    d.toDateString() === now.toDateString()
      ? ""
      : `${d.toLocaleDateString(undefined, { weekday: "short" })} `;
  return `until ${day}${clock(d)}`;
}

// The report's times are SQLite's UTC "YYYY-MM-DD HH:MM:SS".
const utc = (t: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(" ", "T")}Z`);

export function awayRange(startedAt: string, endedAt: string): string {
  const a = utc(startedAt);
  const b = utc(endedAt);
  const sameDay = a.toDateString() === b.toDateString();
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "short" });
  return sameDay
    ? `${clock(a)} to ${clock(b)}`
    : `${day(a)} ${clock(a)} to ${day(b)} ${clock(b)}`;
}
