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

        // Accelerate after several repeats
        if (repeatCountRef.current === 8 && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(() => {
            haptic();
            onKeyPress();
          }, 50); // Fast repeat
        }
      }, 120); // Initial repeat speed
    }, 400); // Initial delay before repeat starts
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
