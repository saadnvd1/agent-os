// Read/unread is local to a browser: the id of the newest entry seen.
// Pure, so a native client can use the same rules.

export const SEEN_KEY = "aos:whatsnew:seen";
export const UNREAD_CAP = 9;

/** How many of the newest entries are newer than the seen id (capped by the head's list). */
export function unreadCount(recent: number[], seen: number | null): number {
  if (seen === null) return 0;
  return recent.filter((id) => id > seen).length;
}

export const unreadLabel = (n: number) =>
  n > UNREAD_CAP ? `${UNREAD_CAP}+` : String(n);
