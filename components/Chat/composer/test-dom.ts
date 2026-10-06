import { JSDOM } from "jsdom";

// A browser for editor tests. The suite runs in node (its setup file is
// node-only), so the DOM is installed by hand before TipTap loads.
const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown>;
for (const key of [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const) {
  if (!(key in g) || key === "navigator") {
    Object.defineProperty(g, key, {
      value:
        key === "window"
          ? window
          : (window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
}
document.createRange = () => {
  const range = new window.Range();
  range.getClientRects = () => [] as unknown as DOMRectList;
  range.getBoundingClientRect = () => new window.DOMRect();
  return range;
};
window.HTMLElement.prototype.getClientRects = () =>
  [] as unknown as DOMRectList;
window.HTMLElement.prototype.scrollIntoView = () => {};

// What a clipboard carries, enough for the paste handler.
export function clipboard(items: Record<string, string>): ClipboardEvent {
  const clipboardData = {
    files: [] as File[],
    getData: (type: string) => items[type] ?? "",
  };
  return { clipboardData } as unknown as ClipboardEvent;
}
