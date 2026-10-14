"use client";

import { useEffect, useRef, type PointerEvent } from "react";

const HOLD_MS = 500;
const SLOP_PX = 10;

// A touch held still on an element. Moving the finger (a scroll) cancels it;
// a mouse never triggers it.
export function useLongPress(onLongPress: (() => void) | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  if (!onLongPress) return {};
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      cancel();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        cancel();
        navigator.vibrate?.(10);
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
