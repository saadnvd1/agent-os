"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DISMISSED_RUN_KEY, DISMISSED_VERSION_KEY } from "@/lib/updates/banner";

// What this browser has dismissed: the version whose banner was closed, and
// the failed or built run whose notice was. In localStorage, so it holds
// across reloads, and per browser because a tab with no device identity
// can't be told apart server-side.
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
  listeners.forEach((fn) => fn());
}

export function useDismissedUpdate() {
  const version = useSyncExternalStore(
    subscribe,
    () => read(DISMISSED_VERSION_KEY),
    () => null
  );
  const run = useSyncExternalStore(
    subscribe,
    () => read(DISMISSED_RUN_KEY),
    () => null
  );
  const dismissVersion = useCallback(
    (v: string) => write(DISMISSED_VERSION_KEY, v),
    []
  );
  const dismissRun = useCallback(
    (id: string) => write(DISMISSED_RUN_KEY, id),
    []
  );
  return { version, run, dismissVersion, dismissRun };
}
