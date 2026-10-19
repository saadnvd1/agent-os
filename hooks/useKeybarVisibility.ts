"use client";

import { useCallback } from "react";
import { useStoredFlag } from "./useStoredFlag";

const STORAGE_KEY = "agentOS-keybar-visible";

/**
 * Hook to manage mobile keybar visibility with localStorage persistence.
 * Default: hidden on mobile to maximize terminal space.
 */
export function useKeybarVisibility() {
  const [isVisible, setVisible] = useStoredFlag(STORAGE_KEY, false);

  const toggle = useCallback(
    () => setVisible(!isVisible),
    [isVisible, setVisible]
  );
  const show = useCallback(() => setVisible(true), [setVisible]);
  const hide = useCallback(() => setVisible(false), [setVisible]);

  return { isVisible, toggle, show, hide };
}
