"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { updateSelection } from "@/lib/rangeSelectionUtils";

interface SessionMultiSelectContextType {
  selectedSessionIds: Set<string>;
  lastSelectedId: string | null;
  toggleSessionSelection: (sessionId: string, shiftKey?: boolean, allSessionIds?: string[]) => void;
  clearSelection: () => void;
  selectAll: (sessionIds: string[]) => void;
  isSessionSelected: (sessionId: string) => boolean;
  getSelectedCount: () => number;
  getSelectedSessionIds: () => string[];
}

const SessionMultiSelectContext = createContext<SessionMultiSelectContextType | null>(null);

export function SessionMultiSelectProvider({ children }: { children: ReactNode }) {
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const toggleSessionSelection = useCallback(
    (sessionId: string, shiftKey = false, allSessionIds: string[] = []) => {
      setSelectedSessionIds((prev) => {
        const newSet = updateSelection(prev, sessionId, shiftKey, lastSelectedId, allSessionIds);
        return newSet;
      });
      setLastSelectedId(sessionId);
    },
    [lastSelectedId]
  );

  const clearSelection = useCallback(() => {
    setSelectedSessionIds(new Set());
    setLastSelectedId(null);
  }, []);

  const selectAll = useCallback((sessionIds: string[]) => {
    setSelectedSessionIds(new Set(sessionIds));
  }, []);

  const isSessionSelected = useCallback(
    (sessionId: string) => selectedSessionIds.has(sessionId),
    [selectedSessionIds]
  );

  const getSelectedCount = useCallback(() => selectedSessionIds.size, [selectedSessionIds]);

  const getSelectedSessionIds = useCallback(
    () => Array.from(selectedSessionIds),
    [selectedSessionIds]
  );

  const value = useMemo(
    () => ({
      selectedSessionIds,
      lastSelectedId,
      toggleSessionSelection,
      clearSelection,
      selectAll,
      isSessionSelected,
      getSelectedCount,
      getSelectedSessionIds,
    }),
    [
      selectedSessionIds,
      lastSelectedId,
      toggleSessionSelection,
      clearSelection,
      selectAll,
      isSessionSelected,
      getSelectedCount,
      getSelectedSessionIds,
    ]
  );

  return (
    <SessionMultiSelectContext.Provider value={value}>
      {children}
    </SessionMultiSelectContext.Provider>
  );
}

export function useSessionMultiSelect(): SessionMultiSelectContextType {
  const context = useContext(SessionMultiSelectContext);
  if (!context) {
    throw new Error("useSessionMultiSelect must be used within a SessionMultiSelectProvider");
  }
  return context;
}

/**
 * Safe version that returns no-op functions if not wrapped in provider
 */
export function useSessionMultiSelectSafe(): SessionMultiSelectContextType {
  const context = useContext(SessionMultiSelectContext);
  if (!context) {
    return {
      selectedSessionIds: new Set(),
      lastSelectedId: null,
      toggleSessionSelection: () => {},
      clearSelection: () => {},
      selectAll: () => {},
      isSessionSelected: () => false,
      getSelectedCount: () => 0,
      getSelectedSessionIds: () => [],
    };
  }
  return context;
}
