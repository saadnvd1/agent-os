import { proxy } from "valtio";
import { updateSelection } from "@/lib/rangeSelectionUtils";

// Store state
export const selectionStore = proxy({
  selectedIds: new Set<string>(),
  lastSelectedId: null as string | null,
});

// Actions - can be called from anywhere
export const selectionActions = {
  toggle: (
    sessionId: string,
    shiftKey = false,
    allSessionIds: string[] = []
  ) => {
    const newSet = updateSelection(
      selectionStore.selectedIds,
      sessionId,
      shiftKey,
      selectionStore.lastSelectedId,
      allSessionIds
    );
    selectionStore.selectedIds = newSet;
    selectionStore.lastSelectedId = sessionId;
  },

  selectAll: (sessionIds: string[]) => {
    selectionStore.selectedIds = new Set(sessionIds);
  },

  clear: () => {
    selectionStore.selectedIds = new Set();
    selectionStore.lastSelectedId = null;
  },

  isSelected: (sessionId: string) => {
    return selectionStore.selectedIds.has(sessionId);
  },

  getCount: () => {
    return selectionStore.selectedIds.size;
  },

  getSelectedIds: () => {
    return Array.from(selectionStore.selectedIds);
  },
};
