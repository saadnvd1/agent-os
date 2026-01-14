"use client";

import { useRef, useCallback } from "react";

// Trigger haptic feedback if available
function haptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(5);
  }
}

export function useKeyRepeat(onKeyPress: () => void) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const repeatCountRef = useRef(0);

  const startRepeat = useCallback(() => {
    // Immediate first press
    haptic();
    onKeyPress();
    repeatCountRef.current = 0;

    // Start repeating after initial delay (like native keyboard)
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        haptic();
        onKeyPress();
        repeatCountRef.current++;

        // Accelerate after many repeats (more gradual than before)
        if (repeatCountRef.current === 15 && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(() => {
            haptic();
            onKeyPress();
          }, 80); // Fast repeat (was 50, now slower)
        }
      }, 150); // Initial repeat speed (was 120, now slower)
    }, 500); // Initial delay before repeat starts (was 400, now longer)
  }, [onKeyPress]);

  const stopRepeat = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    repeatCountRef.current = 0;
  }, []);

  return { startRepeat, stopRepeat };
}
