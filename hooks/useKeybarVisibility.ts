"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "agentOS-keybar-visible";

/**
 * Hook to manage mobile keybar visibility with localStorage persistence.
 * Default: hidden on mobile to maximize terminal space.
 */
export function useKeybarVisibility() {
  const [isVisible, setIsVisible] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") {
      setIsVisible(true);
    }
  }, []);

  const toggle = useCallback(() => {
    setIsVisible((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const show = useCallback(() => {
    setIsVisible(true);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  const hide = useCallback(() => {
    setIsVisible(false);
    localStorage.setItem(STORAGE_KEY, "false");
  }, []);

  return { isVisible, toggle, show, hide };
}
