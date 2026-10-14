"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";

// A touch screen with no keyboard to speak of: taps, not shortcuts.
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
