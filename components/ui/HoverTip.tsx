"use client";

import { useEffect } from "react";
import { installHoverTip } from "@/lib/hover-tip";

// Mounted once: the app's single hover tooltip (lib/hover-tip.ts).
export function HoverTip() {
  useEffect(() => installHoverTip(), []);
  return null;
}
