"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ChatItem } from "@/lib/chat/events";
import { locate } from "@/lib/chat/find";
import type { RowStore } from "./rowState";

interface Deps {
  items: ChatItem[];
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
  rows: RowStore;
  release: () => void;
  scrollToBlock: (block: string) => Promise<void>;
  foldEvents: boolean;
}

// Takes the reader to a message by a rule over the loaded items (the strip's
// "the message where the question was asked"): older pages load until it is
// found, then its folded rows open and it scrolls into view.
export function useGoToItem(d: Deps) {
  const [find, setFind] = useState<{
    match: (items: ChatItem[]) => string | null;
    at: number;
  } | null>(null);
  const { items, hasMore, loadingOlder, loadOlder, rows, release } = d;
  const { scrollToBlock, foldEvents } = d;
  useEffect(() => {
    if (!find) return;
    const id = find.match(items);
    const where = id ? locate(items, id, { foldEvents }) : null;
    if (!where) {
      if (hasMore) {
        if (!loadingOlder) loadOlder();
      } else {
        toast("That message isn't loaded");
        queueMicrotask(() => setFind(null));
      }
      return;
    }
    queueMicrotask(() => setFind(null));
    for (const key of where.open) rows.set(key, true);
    release();
    // A folded turn in a long group: the turn itself, not the group's middle.
    const turn = where.open.find((k) => k.startsWith("eventturn:"));
    scrollToBlock(where.block)
      .then(() => new Promise((r) => requestAnimationFrame(r)))
      .then(() =>
        document
          .querySelector(
            `[data-event-turn="${CSS.escape(turn?.slice(10) ?? "")}"]`
          )
          ?.scrollIntoView({ block: "center" })
      )
      .catch(() => {});
  }, [
    find,
    items,
    hasMore,
    loadingOlder,
    loadOlder,
    rows,
    release,
    scrollToBlock,
    foldEvents,
  ]);
  return (match: (items: ChatItem[]) => string | null) =>
    setFind({ match, at: Date.now() });
}
