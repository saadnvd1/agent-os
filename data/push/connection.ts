import { useSyncExternalStore } from "react";

// Whether the push stream (/ws/status) is up. Queries it keeps fresh poll
// only while it's down.
let connected = false;
const listeners = new Set<() => void>();

export function setPushConnected(value: boolean): void {
  if (value === connected) return;
  connected = value;
  listeners.forEach((fn) => fn());
}

export function usePushConnected(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => connected,
    () => false
  );
}

/** A query's poll interval: none while changes are pushed, `ms` otherwise. */
export function usePollWhenOffline(ms: number): number | false {
  return usePushConnected() ? false : ms;
}
