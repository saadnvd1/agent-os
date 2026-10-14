"use client";

import { useEffect } from "react";

// Mounted once: the app's single hover tooltip (lib/hover-tip.ts), loaded
// after the page so it costs the first load nothing.
export function HoverTip() {
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    import("@/lib/hover-tip").then(({ installHoverTip }) => {
      if (!gone) off = installHoverTip();
    });
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  return null;
}
