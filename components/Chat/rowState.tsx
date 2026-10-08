"use client";

import { createContext, useCallback, useContext, useState } from "react";

// State a timeline row keeps across being scrolled out and back: the list
// unmounts rows it doesn't show, so an opened step or a sized artifact would
// otherwise start over each time it comes back. One store per conversation.
export const RowState = createContext<Map<string, unknown> | null>(null);

export function useRowState<T>(
  key: string,
  initial: T
): [T, (next: T) => void] {
  const store = useContext(RowState);
  const [value, setValue] = useState<T>(() =>
    store?.has(key) ? (store.get(key) as T) : initial
  );
  const set = useCallback(
    (next: T) => {
      store?.set(key, next);
      setValue(next);
    },
    [store, key]
  );
  return [value, set];
}
