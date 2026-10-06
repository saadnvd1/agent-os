"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "agentos:composer:plain";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Plain mode (no live formatting) is a per-browser choice, shared by every
// composer on the page.
export function usePlainMode(): [boolean, (plain: boolean) => void] {
  const plain = useSyncExternalStore(subscribe, read, () => false);
  const set = useCallback((next: boolean) => {
    try {
      if (next) localStorage.setItem(KEY, "1");
      else localStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
    listeners.forEach((l) => l());
  }, []);
  return [plain, set];
}
