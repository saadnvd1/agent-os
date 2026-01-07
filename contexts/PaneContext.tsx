"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  type PaneState,
  type PaneData,
  type TabData,
  createInitialPaneState,
  createPaneData,
  createTab,
  splitPane,
  closePane,
  countPanes,
  savePaneState,
  loadPaneState,
  MAX_PANES,
} from "@/lib/panes";

interface PaneContextValue {
  state: PaneState;
  focusedPaneId: string;
  canSplit: boolean;
  canClose: boolean;
  focusPane: (paneId: string) => void;
  splitHorizontal: (paneId: string) => void;
  splitVertical: (paneId: string) => void;
  close: (paneId: string) => void;
  // Tab management
  addTab: (paneId: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  switchTab: (paneId: string, tabId: string) => void;
  // Session management (operates on active tab)
  attachSession: (paneId: string, sessionId: string, tmuxName: string) => void;
  detachSession: (paneId: string) => void;
  getPaneData: (paneId: string) => PaneData;
  getActiveTab: (paneId: string) => TabData | null;
}

const PaneContext = createContext<PaneContextValue | null>(null);

// Default pane data for migration from old format
const defaultPaneData: PaneData = createPaneData();

export function PaneProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PaneState>(createInitialPaneState);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage after hydration
  useEffect(() => {
    const saved = loadPaneState();
    if (saved) {
      // Migrate old pane data format if needed
      const migratedPanes: Record<string, PaneData> = {};
      for (const [paneId, paneData] of Object.entries(saved.panes)) {
        if ('tabs' in paneData && Array.isArray(paneData.tabs)) {
          // New format
          migratedPanes[paneId] = paneData as PaneData;
        } else {
          // Old format - migrate to new
          const oldData = paneData as { sessionId?: string | null; attachedTmux?: string | null };
          const tab = createTab();
          tab.sessionId = oldData.sessionId || null;
          tab.attachedTmux = oldData.attachedTmux || null;
          migratedPanes[paneId] = {
            tabs: [tab],
            activeTabId: tab.id,
          };
        }
      }
      setState({ ...saved, panes: migratedPanes });
    }
    setHydrated(true);
  }, []);

  // Persist state changes to localStorage (only after hydration)
  useEffect(() => {
    if (hydrated) {
      savePaneState(state);
    }
  }, [state, hydrated]);

  const focusPane = useCallback((paneId: string) => {
    setState((prev) => ({ ...prev, focusedPaneId: paneId }));
  }, []);

  const splitHorizontal = useCallback((paneId: string) => {
    setState((prev) => {
      const newState = splitPane(prev, paneId, "horizontal");
      return newState || prev;
    });
  }, []);

  const splitVertical = useCallback((paneId: string) => {
    setState((prev) => {
      const newState = splitPane(prev, paneId, "vertical");
      return newState || prev;
    });
  }, []);

  const close = useCallback((paneId: string) => {
    setState((prev) => {
      const newState = closePane(prev, paneId);
      return newState || prev;
    });
  }, []);

  // Tab management
  const addTab = useCallback((paneId: string) => {
    setState((prev) => {
      const pane = prev.panes[paneId];
      if (!pane) return prev;
      const newTab = createTab();
      return {
        ...prev,
        panes: {
          ...prev.panes,
          [paneId]: {
            ...pane,
            tabs: [...pane.tabs, newTab],
            activeTabId: newTab.id,
          },
        },
      };
    });
  }, []);

  const closeTab = useCallback((paneId: string, tabId: string) => {
    setState((prev) => {
      const pane = prev.panes[paneId];
      if (!pane || pane.tabs.length <= 1) return prev; // Keep at least one tab

      const newTabs = pane.tabs.filter((t) => t.id !== tabId);
      const newActiveTabId = pane.activeTabId === tabId
        ? newTabs[0].id
        : pane.activeTabId;

      return {
        ...prev,
        panes: {
          ...prev.panes,
          [paneId]: {
            ...pane,
            tabs: newTabs,
            activeTabId: newActiveTabId,
          },
        },
      };
    });
  }, []);

  const switchTab = useCallback((paneId: string, tabId: string) => {
    setState((prev) => {
      const pane = prev.panes[paneId];
      if (!pane) return prev;
      return {
        ...prev,
        panes: {
          ...prev.panes,
          [paneId]: {
            ...pane,
            activeTabId: tabId,
          },
        },
      };
    });
  }, []);

  // Attach session to active tab
  const attachSession = useCallback(
    (paneId: string, sessionId: string, tmuxName: string) => {
      setState((prev) => {
        const pane = prev.panes[paneId];
        if (!pane) return prev;

        const newTabs = pane.tabs.map((tab) =>
          tab.id === pane.activeTabId
            ? { ...tab, sessionId, attachedTmux: tmuxName }
            : tab
        );

        return {
          ...prev,
          panes: {
            ...prev.panes,
            [paneId]: { ...pane, tabs: newTabs },
          },
        };
      });
    },
    []
  );

  // Detach session from active tab
  const detachSession = useCallback((paneId: string) => {
    setState((prev) => {
      const pane = prev.panes[paneId];
      if (!pane) return prev;

      const newTabs = pane.tabs.map((tab) =>
        tab.id === pane.activeTabId
          ? { ...tab, sessionId: null, attachedTmux: null }
          : tab
      );

      return {
        ...prev,
        panes: {
          ...prev.panes,
          [paneId]: { ...pane, tabs: newTabs },
        },
      };
    });
  }, []);

  const getPaneData = useCallback(
    (paneId: string): PaneData => {
      return state.panes[paneId] || defaultPaneData;
    },
    [state.panes]
  );

  const getActiveTab = useCallback(
    (paneId: string): TabData | null => {
      const pane = state.panes[paneId];
      if (!pane) return null;
      return pane.tabs.find((t) => t.id === pane.activeTabId) || null;
    },
    [state.panes]
  );

  const canSplit = countPanes(state.layout) < MAX_PANES;
  const canClose = countPanes(state.layout) > 1;

  return (
    <PaneContext.Provider
      value={{
        state,
        focusedPaneId: state.focusedPaneId,
        canSplit,
        canClose,
        focusPane,
        splitHorizontal,
        splitVertical,
        close,
        addTab,
        closeTab,
        switchTab,
        attachSession,
        detachSession,
        getPaneData,
        getActiveTab,
      }}
    >
      {children}
    </PaneContext.Provider>
  );
}

export function usePanes() {
  const context = useContext(PaneContext);
  if (!context) {
    throw new Error("usePanes must be used within a PaneProvider");
  }
  return context;
}
