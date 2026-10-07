import { useSyncExternalStore } from "react";

// One shared clock for "5m ago" labels: re-renders its readers every 30s,
// so they stay current without their lists redrawing for it.
const listeners = new Set<() => void>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => {
    tick++;
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
