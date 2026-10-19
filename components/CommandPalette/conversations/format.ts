// When a message was said: the time today, else the date.
export function whenLabel(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export const plain = (segments: { text: string }[]) =>
  segments
    .map((s) => s.text)
    .join("")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

const LIVE = new Set(["running", "idle", "waiting"]);

// What became of a conversation, when it is not simply alive.
export const statusChip = (status: string): string | null =>
  LIVE.has(status) ? null : status;
