"use client";

import { useSyncExternalStore } from "react";

const supported = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

// Whether a CSS media query matches now, and stays in step as it changes.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (!supported()) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
    () => supported() && window.matchMedia(query).matches,
    () => false
  );
}
