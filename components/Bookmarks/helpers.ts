import type { Bookmark, BookmarkState } from "@/lib/bookmarks/types";

export const KIND_LABEL: Record<Bookmark["kind"], string> = {
  user: "You",
  assistant: "Reply",
  tool: "Tool",
  turn: "Turn",
};

export const STATE_BADGE: Record<BookmarkState, string | null> = {
  live: null,
  moved: null,
  archived: "archived",
  deleted: "conversation deleted",
};

// A deleted chat has nothing to open.
export const canOpen = (b: Bookmark) => b.state !== "deleted";

// SQLite's datetime('now') is UTC without a zone.
export const createdAt = (b: Bookmark) =>
  new Date(
    /[zZ]|[+-]\d\d:?\d\d$/.test(b.createdAt)
      ? b.createdAt
      : b.createdAt.replace(" ", "T") + "Z"
  );

export const excerpt = (text: string, max = 240) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
};

function dayLabel(d: Date, now: Date): string {
  const start = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

/** Newest-first bookmarks, in runs by local day. */
export function groupByDay(
  bookmarks: Bookmark[],
  now = new Date()
): { day: string; bookmarks: Bookmark[] }[] {
  const out: { day: string; bookmarks: Bookmark[] }[] = [];
  for (const b of bookmarks) {
    const day = dayLabel(createdAt(b), now);
    const last = out[out.length - 1];
    if (last?.day === day) last.bookmarks.push(b);
    else out.push({ day, bookmarks: [b] });
  }
  return out;
}

export const timeOf = (b: Bookmark) =>
  createdAt(b).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
