"use client";

import { createContext, useContext, useMemo } from "react";
import type { PaneLayout } from "@/lib/panes";
import { usePanes } from "@/contexts/PaneContext";

// The desktop has no app bar of its own: app-wide controls ride in the pane
// bars, the sidebar toggle in the top-left pane's and the global actions in
// the top-right pane's, so a single pane is a single row and a split still
// gives each pane its own controls.
interface PaneBarSlots {
  leading: React.ReactNode;
  trailing: React.ReactNode;
}

const PaneBarSlotsContext = createContext<PaneBarSlots | null>(null);

function topLeftPane(layout: PaneLayout): string {
  return layout.type === "leaf"
    ? layout.paneId
    : topLeftPane(layout.children[0]);
}

function topRightPane(layout: PaneLayout): string {
  if (layout.type === "leaf") return layout.paneId;
  const child =
    layout.direction === "horizontal"
      ? layout.children[layout.children.length - 1]
      : layout.children[0];
  return topRightPane(child);
}

export function PaneBarSlotsProvider({
  leading,
  trailing,
  children,
}: PaneBarSlots & { children: React.ReactNode }) {
  const value = useMemo(() => ({ leading, trailing }), [leading, trailing]);
  return (
    <PaneBarSlotsContext.Provider value={value}>
      {children}
    </PaneBarSlotsContext.Provider>
  );
}

export function usePaneBarSlots(paneId: string): PaneBarSlots {
  const slots = useContext(PaneBarSlotsContext);
  const { state } = usePanes();
  if (!slots) return { leading: null, trailing: null };
  return {
    leading: topLeftPane(state.layout) === paneId ? slots.leading : null,
    trailing: topRightPane(state.layout) === paneId ? slots.trailing : null,
  };
}
