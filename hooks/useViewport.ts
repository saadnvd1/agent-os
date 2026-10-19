"use client";

import { useSyncExternalStore } from "react";
import { useMediaQuery } from "./useMediaQuery";

const noop = () => () => {};

/**
 * Mobile-first viewport detection hook
 * Breakpoint: 768px (md in Tailwind)
 */
export function useViewport() {
  const isMobile = useMediaQuery("(max-width: 767.98px)");
  // False on the server and while hydrating, true after.
  const isHydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false
  );

  return {
    isMobile,
    isDesktop: !isMobile,
    isHydrated, // For avoiding hydration mismatches
  };
}
