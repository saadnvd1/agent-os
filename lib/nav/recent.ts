// Which chat was open before this one, and chats most-recently-opened first.
// "Opened" is the chat's viewed_at, which the page stamps whenever a chat is
// shown, so it is the same on every device.

/** When each chat was last opened, by session id (epoch ms). */
export type Opened = Record<string, number | undefined>;

/** Most recently opened first; never-opened chats keep their order after. */
export function recentFirst<T extends { id: string }>(
  items: readonly T[],
  opened: Opened
): T[] {
  return items
    .map((item, i) => ({ item, i, at: opened[item.id] ?? -1 }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .map((x) => x.item);
}

/** The chat opened just before the current one, among those still open. */
export function previousChatId(
  ids: readonly string[],
  opened: Opened,
  currentId: string | null | undefined
): string | null {
  let best: string | null = null;
  let bestAt = -1;
  for (const id of ids) {
    const at = opened[id];
    if (id === currentId || at === undefined || at <= bestAt) continue;
    best = id;
    bestAt = at;
  }
  return best;
}
