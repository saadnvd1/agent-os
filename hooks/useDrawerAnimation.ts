import { useState, useEffect } from "react";

/**
 * Hook for smooth drawer enter animations.
 * Uses double requestAnimationFrame to trigger CSS transition after mount.
 */
export function useDrawerAnimation(open: boolean) {
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);

  useEffect(() => {
    if (!open) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setIsAnimatingIn(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      setIsAnimatingIn(false);
    };
  }, [open]);

  return open && isAnimatingIn;
}
