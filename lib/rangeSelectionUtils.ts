/**
 * Range Selection Utilities
 *
 * Handles shift+click range selection for multi-select patterns.
 */

/**
 * Toggle a single item's selection
 */
export function toggleSelection(
  selectedSet: Set<string>,
  itemId: string
): Set<string> {
  const newSet = new Set(selectedSet);
  if (newSet.has(itemId)) {
    newSet.delete(itemId);
  } else {
    newSet.add(itemId);
  }
  return newSet;
}

/**
 * Select a range of items between lastSelectedId and current itemId
 */
export function selectRange(
  selectedSet: Set<string>,
  itemId: string,
  lastSelectedId: string,
  allItemIds: string[]
): Set<string> {
  const currentIndex = allItemIds.indexOf(itemId);
  const lastIndex = allItemIds.indexOf(lastSelectedId);

  if (currentIndex === -1 || lastIndex === -1) {
    return toggleSelection(selectedSet, itemId);
  }

  const start = Math.min(currentIndex, lastIndex);
  const end = Math.max(currentIndex, lastIndex);

  const newSet = new Set(selectedSet);
  for (let i = start; i <= end; i++) {
    newSet.add(allItemIds[i]);
  }

  return newSet;
}

/**
 * Main selection update function
 * Routes to range selection or single toggle based on shift key
 */
export function updateSelection(
  selectedSet: Set<string>,
  itemId: string,
  isShiftClick: boolean,
  lastSelectedId: string | null,
  allItemIds: string[]
): Set<string> {
  if (isShiftClick && lastSelectedId && allItemIds.length > 0) {
    return selectRange(selectedSet, itemId, lastSelectedId, allItemIds);
  }
  return toggleSelection(selectedSet, itemId);
}
