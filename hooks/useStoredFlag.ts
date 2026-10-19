"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// A boolean kept in localStorage, shared by every caller on the page. The
// server and the hydrating render see `fallback`; the stored value follows.
export function useStoredFlag(
  key: string,
  fallback: boolean
): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  );
  const set = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Storage unavailable: the choice lasts until reload.
      }
      listeners.forEach((fn) => fn());
    },
    [key]
  );
  return [value === null ? fallback : value === "true", set];
}
