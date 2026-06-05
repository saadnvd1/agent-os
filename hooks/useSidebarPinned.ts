"use client";

import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "agentOS-sidebar-pinned";

/**
 * Hook to manage desktop sidebar pin state with localStorage persistence.
 * Pinned (default): sidebar is docked and pushes content.
 * Unpinned: sidebar collapses to give the main pane more room and
 * reveals on hover near the left edge.
 */
export function useSidebarPinned() {
  const [isPinned, setIsPinned] = useState(true);

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "false") {
      setIsPinned(false);
    }
  }, []);

  const setPinned = useCallback((pinned: boolean) => {
    setIsPinned(pinned);
    localStorage.setItem(STORAGE_KEY, String(pinned));
  }, []);

  const togglePin = useCallback(() => {
    setIsPinned((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { isPinned, togglePin, setPinned };
}
