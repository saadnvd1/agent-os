"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// State a timeline row keeps across being scrolled out and back: the list
// unmounts rows it doesn't show, so an opened step or a sized artifact would
// otherwise start over each time it comes back. One store per conversation.
// Rows on screen hear a change made from outside them (find opening a step).
export class RowStore {
  private values = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();

  has(key: string) {
    return this.values.has(key);
  }
  get(key: string) {
    return this.values.get(key);
  }
  set(key: string, value: unknown) {
    if (this.values.get(key) === value && this.values.has(key)) return;
    this.values.set(key, value);
    for (const fn of this.listeners.get(key) ?? []) fn();
  }
  subscribe(key: string, fn: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(key);
    };
  }
}

export const RowState = createContext<RowStore | null>(null);

export function useRowState<T>(
  key: string,
  initial: T
): [T, (next: T) => void] {
  const store = useContext(RowState);
  const [value, setValue] = useState<T>(() =>
    store?.has(key) ? (store.get(key) as T) : initial
  );
  useEffect(
    () =>
      store?.subscribe(key, () => {
        if (store.has(key)) setValue(store.get(key) as T);
      }),
    [store, key]
  );
  const set = useCallback(
    (next: T) => {
      if (store) store.set(key, next);
      else setValue(next);
    },
    [store, key]
  );
  return [value, set];
}
