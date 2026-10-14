"use client";

import { useMediaQuery } from "./useMediaQuery";

// A phone or a touch screen: menus use one scrolling list with sections that
// open in place, not flyouts a finger can't hold open.
export function useCompactMenu(): boolean {
  return useMediaQuery("(max-width: 767px), (pointer: coarse)");
}
