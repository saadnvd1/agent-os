"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 14;

const STORAGE_KEY = "terminal-font-size";
const WHEEL_STEP = 1;
const RESIZE_DEBOUNCE_MS = 150;

const clampSize = (size: number): number =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));

export function zoomFontSize(
  startDistance: number,
  currentDistance: number,
  startSize: number
): number {
  if (startDistance <= 0) return startSize;
  return clampSize((startSize * currentDistance) / startDistance);
}

export function loadFontSize(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE) return stored;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_FONT_SIZE;
}

const pinchDistance = (touches: TouchList): number =>
  Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );

export function setupZoom(
  term: XTerm,
  fitAddon: FitAddon,
  sendResize: (cols: number, rows: number) => void
): () => void {
  const element = term.element;
  if (!element) return () => {};

  let startDistance = 0;
  let startSize = DEFAULT_FONT_SIZE;
  let zoomed = false;
  let resizeTimeout: NodeJS.Timeout | null = null;

  const applySize = (size: number) => {
    if (size === term.options.fontSize) return;
    term.options.fontSize = size;
    fitAddon.fit();
    zoomed = true;
  };

  const commit = () => {
    if (!zoomed) return;
    zoomed = false;
    try {
      localStorage.setItem(STORAGE_KEY, String(term.options.fontSize));
    } catch {
      /* localStorage unavailable */
    }
    sendResize(term.cols, term.rows);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    startDistance = pinchDistance(e.touches);
    startSize = term.options.fontSize ?? DEFAULT_FONT_SIZE;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2 || startDistance <= 0) return;
    e.preventDefault();
    applySize(zoomFontSize(startDistance, pinchDistance(e.touches), startSize));
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length >= 2) return;
    startDistance = 0;
    commit();
  };

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const size = (term.options.fontSize ?? DEFAULT_FONT_SIZE) + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP);
    applySize(clampSize(size));
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(commit, RESIZE_DEBOUNCE_MS);
  };

  element.addEventListener("touchstart", onTouchStart, { passive: true });
  element.addEventListener("touchmove", onTouchMove, { passive: false });
  element.addEventListener("touchend", onTouchEnd);
  element.addEventListener("touchcancel", onTouchEnd);
  element.addEventListener("wheel", onWheel, { passive: false, capture: true });

  return () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    element.removeEventListener("touchstart", onTouchStart);
    element.removeEventListener("touchmove", onTouchMove);
    element.removeEventListener("touchend", onTouchEnd);
    element.removeEventListener("touchcancel", onTouchEnd);
    element.removeEventListener("wheel", onWheel, { capture: true });
  };
}
