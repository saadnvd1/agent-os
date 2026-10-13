"use client";

import { useSyncExternalStore } from "react";

// The phone layout (MobileView) is the one under 768px, as in useViewport.
const QUERY = "(max-width: 767px)";

export function isPhoneLayout(): boolean {
  return window.matchMedia(QUERY).matches;
}

function subscribe(listener: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhoneLayout, () => false);
}
