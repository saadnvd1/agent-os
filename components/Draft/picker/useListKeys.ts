import type { KeyboardEvent, RefObject } from "react";

const ROWS = "[data-pick-row]:not(:disabled)";

/**
 * Keyboard for a picker: ↑/↓ walk the rows (↑ from the first goes back to
 * the search), ⏎ in the search takes the first row, / jumps to the search,
 * and ←/→ step the agent when the caret isn't in the search.
 */
export function useListKeys(
  root: RefObject<HTMLElement | null>,
  search: RefObject<HTMLInputElement | null>,
  onStepAgent?: (delta: 1 | -1) => void
) {
  return (e: KeyboardEvent) => {
    const el = root.current;
    if (!el || e.metaKey || e.ctrlKey || e.altKey) return;
    const inSearch = e.target === search.current;
    const rows = [...el.querySelectorAll<HTMLElement>(ROWS)];
    const at = rows.indexOf(e.target as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next =
        e.key === "ArrowDown"
          ? rows[inSearch || at < 0 ? 0 : Math.min(at + 1, rows.length - 1)]
          : at > 0
            ? rows[at - 1]
            : search.current;
      if (!next) return;
      e.preventDefault();
      next.focus();
    } else if (e.key === "Enter" && inSearch) {
      if (!rows[0]) return;
      e.preventDefault();
      rows[0].click();
    } else if (e.key === "/" && !inSearch) {
      e.preventDefault();
      search.current?.focus();
    } else if (
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      !inSearch &&
      onStepAgent
    ) {
      e.preventDefault();
      onStepAgent(e.key === "ArrowRight" ? 1 : -1);
    }
  };
}

/** Focus the ticked row, else the first, so the arrows work at once. */
export function focusSelectedRow(root: HTMLElement | null): void {
  const rows = root?.querySelectorAll<HTMLElement>(ROWS);
  (root?.querySelector<HTMLElement>("[data-selected]") ?? rows?.[0])?.focus();
}
