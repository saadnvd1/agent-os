"use client";

import { useState, useEffect } from "react";

/**
 * Mobile-first viewport detection hook
 * Breakpoint: 768px (md in Tailwind)
 */
export function useViewport() {
  const [isMobile, setIsMobile] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const checkViewport = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Initial check
    checkViewport();
    setIsHydrated(true);

    // Listen for resize
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  return {
    isMobile,
    isDesktop: !isMobile,
    isHydrated, // For avoiding hydration mismatches
  };
}
