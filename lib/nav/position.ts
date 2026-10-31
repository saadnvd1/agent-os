import type { ChatItem } from "@/lib/chat/events";
import type { ChatView } from "@/lib/chat-views/types";

/** Where a reader is in a chat: the block in view's key, how far its top is
 * from the top of the list, and whether they follow the latest output. */
export interface Position {
  block: string | null;
  offsetPx: number;
  atEnd: boolean;
}

export interface RowRect {
  key: string;
  top: number;
  bottom: number;
}

/** The first row whose bottom is below the top of the list, and how far its
 * top sits from there (negative when it is partly scrolled off). */
export function anchorOf(
  listTop: number,
  rows: RowRect[],
  atEnd: boolean
): Position {
  if (atEnd) return { block: null, offsetPx: 0, atEnd: true };
  const row = rows.find((r) => r.bottom > listTop + 1);
  if (!row) return { block: null, offsetPx: 0, atEnd: true };
  return {
    block: row.key,
    offsetPx: Math.round(row.top - listTop),
    atEnd: false,
  };
}

export type OpenAt =
  | { kind: "latest" }
  | { kind: "new"; itemId: string; hasBefore: boolean }
  | { kind: "position"; block: string; offsetPx: number };

interface OpenInput {
  /** What the server remembers about this chat; none when never opened. */
  view: Pick<ChatView, "itemId" | "offsetPx" | "atEnd" | "viewedAt"> | null;
  /** The loaded items, oldest first. */
  items: Pick<ChatItem, "id" | "createdAt">[];
  /** Opened from a notification, Needs you or the Inbox. */
  latest: boolean;
}

/**
 * Where a chat opens when nothing asked for a particular message:
 * - from a notification, Needs you or the Inbox: the latest;
 * - with items newer than the last time it was open: the first new one;
 * - otherwise where it was left, unless that was the end;
 * - never opened: the latest.
 */
export function decideOpen({ view, items, latest }: OpenInput): OpenAt {
  if (latest || !view) return { kind: "latest" };
  const firstNew = items.findIndex((i) => i.createdAt > view.viewedAt);
  if (firstNew !== -1)
    return {
      kind: "new",
      itemId: items[firstNew].id,
      hasBefore: firstNew > 0,
    };
  if (view.atEnd || !view.itemId) return { kind: "latest" };
  return { kind: "position", block: view.itemId, offsetPx: view.offsetPx };
}
