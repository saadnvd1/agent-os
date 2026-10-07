import { useEffect } from "react";

// Opt-in timing for the performance pass: build with EXPO_PUBLIC_PERF=1 and
// read the "[perf]" lines from the device log. Off, every call is a no-op.
export const PERF = process.env.EXPO_PUBLIC_PERF === "1";

const once = new Set<string>();

export function mark(name: string, detail?: string | number) {
  if (!PERF) return;
  // Release builds only pass errors on to the device log.
  console.error(`[perf] ${name} ${detail ?? ""}`.trim());
}

export function markOnce(name: string, detail?: string | number) {
  if (!PERF || once.has(name)) return;
  once.add(name);
  mark(name, detail);
}

// JS frames per second, every 2s while `on`.
export function useFps(name: string, on: boolean) {
  useEffect(() => {
    if (!PERF || !on) return;
    let frames = 0;
    let worst = 0;
    let last = Date.now();
    let since = last;
    let raf = requestAnimationFrame(function tick() {
      const now = Date.now();
      worst = Math.max(worst, now - last);
      last = now;
      frames++;
      if (now - since >= 2000) {
        mark(
          name,
          `${Math.round((frames * 1000) / (now - since))}fps worst ${worst}ms`
        );
        frames = 0;
        worst = 0;
        since = now;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [name, on]);
}
