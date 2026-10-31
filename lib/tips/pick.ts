import type { Tip } from "./schema";

export interface Pinned {
  day: string;
  id: string;
  read: boolean;
}

/** Newest first; tips added the same day keep the order they have in the file. */
export const orderDeck = <T extends Pick<Tip, "id" | "added">>(
  tips: T[]
): T[] =>
  [...tips].sort((a, b) =>
    a.added === b.added ? 0 : a.added < b.added ? 1 : -1
  );

/**
 * The tip for `day`: the one already chosen today while it still applies,
 * else the first the user hasn't seen, else (all seen) the one seen longest ago.
 */
export function pickToday(o: {
  deck: { id: string }[];
  seen: Record<string, string>;
  pinned: Pinned | null;
  day: string;
}): Pinned | null {
  const { deck, seen, pinned, day } = o;
  if (!deck.length) return null;
  if (pinned?.day === day && deck.some((t) => t.id === pinned.id))
    return pinned;
  const fresh = deck.find((t) => !seen[t.id]);
  if (fresh) return { day, id: fresh.id, read: false };
  const oldest = deck.reduce((a, b) => (seen[b.id] < seen[a.id] ? b : a));
  return { day, id: oldest.id, read: false };
}
