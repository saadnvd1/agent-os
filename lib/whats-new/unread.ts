// Read/unread is local to a browser: the id of the newest entry seen.
// Pure, so a native client can use the same rules.

export const SEEN_KEY = "aos:whatsnew:seen";

/** How many of the newest entries are newer than the seen id (capped by the head's list). */
export function unreadCount(recent: number[], seen: number | null): number {
  if (seen === null) return 0;
  return recent.filter((id) => id > seen).length;
}
