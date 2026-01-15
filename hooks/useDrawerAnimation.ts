import { useState, useEffect, useRef } from "react";

/**
 * Hook for smooth drawer enter animations.
 * Uses double requestAnimationFrame to trigger CSS transition after mount.
 */
export function useDrawerAnimation(open: boolean) {
  const [isAnimatingIn, setIsAnimatingIn] = useState(false);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (open && !hasAnimated.current) {
      hasAnimated.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimatingIn(true);
        });
      });
    }
    if (!open) {
      hasAnimated.current = false;
      setIsAnimatingIn(false);
    }
  }, [open]);

  return isAnimatingIn;
}
