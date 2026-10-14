"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

// Where each turn starts (a TurnEnd's bookmark marks the turn's first
// message). Kept outside React state so a streamed word redraws only the
// turn ends whose start changed, not every star.
export class TurnStarts {
  private map = new Map<string, string>();
  private listeners = new Set<() => void>();
  set(map: Map<string, string>) {
    this.map = map;
    this.listeners.forEach((l) => l());
  }
  get = (turnEndId: string) => this.map.get(turnEndId) ?? null;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

// The chat the stars inside it belong to.
export interface BookmarkChat {
  sessionId: string;
  turnStarts: TurnStarts;
}

export const BookmarkChatContext = createContext<BookmarkChat | null>(null);

export const useBookmarkChat = () => useContext(BookmarkChatContext);

const NO_STARTS = new TurnStarts();

export function useTurnStart(turnEndId: string): string | null {
  const starts = useBookmarkChat()?.turnStarts ?? NO_STARTS;
  return useSyncExternalStore(
    starts.subscribe,
    () => starts.get(turnEndId),
    () => null
  );
}
