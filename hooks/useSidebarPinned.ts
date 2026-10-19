"use client";

import { useCallback } from "react";
import { useStoredFlag } from "./useStoredFlag";

const STORAGE_KEY = "agentOS-sidebar-pinned";

/**
 * Hook to manage desktop sidebar pin state with localStorage persistence.
 * Pinned (default): sidebar is docked and pushes content.
 * Unpinned: sidebar collapses to give the main pane more room and
 * reveals on hover near the left edge.
 */
export function useSidebarPinned() {
  const [isPinned, setPinned] = useStoredFlag(STORAGE_KEY, true);

  const togglePin = useCallback(
    () => setPinned(!isPinned),
    [isPinned, setPinned]
  );

  return { isPinned, togglePin, setPinned };
}
