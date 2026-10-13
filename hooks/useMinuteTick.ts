import { useSyncExternalStore } from "react";

// One shared clock for "5m ago" labels: re-renders its readers every 30s,
// so they stay current without their lists redrawing for it.
const listeners = new Set<() => void>();
let tick = 0;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  now = Date.now();
  listeners.add(listener);
  timer ??= setInterval(() => {
    tick++;
    now = Date.now();
    listeners.forEach((l) => l());
  }, 30_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useMinuteTick(): number {
  return useSyncExternalStore(
    subscribe,
    () => tick,
    () => tick
  );
}

// The clock itself (ms), moving with the same tick: for code that reads wakes
// and settles from the time.
export function useClock(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now
  );
}
