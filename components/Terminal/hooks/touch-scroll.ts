"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import type { RefObject } from "react";

interface TouchScrollConfig {
  term: XTerm;
  selectModeRef: RefObject<boolean>;
}

export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { term, selectModeRef } = config;

  if (!term.element) return () => {};

  let touchElement: HTMLElement | null = null;
  let handleTouchStart: ((e: TouchEvent) => void) | null = null;
  let handleTouchMove: ((e: TouchEvent) => void) | null = null;
  let handleTouchEnd: (() => void) | null = null;
  let handleTouchCancel: (() => void) | null = null;
  let setupTimeout: NodeJS.Timeout | null = null;

  const setupTouchScrollInner = () => {
    const xtermScreen = term.element?.querySelector(
      ".xterm-screen"
    ) as HTMLElement | null;
    if (!xtermScreen) {
      setupTimeout = setTimeout(setupTouchScrollInner, 50);
      return;
    }

    xtermScreen.style.touchAction = "none";
    xtermScreen.style.userSelect = "none";
    (
      xtermScreen.style as CSSStyleDeclaration & { webkitUserSelect?: string }
    ).webkitUserSelect = "none";

    const canvases = xtermScreen.querySelectorAll("canvas");
    canvases.forEach((canvas) => {
      (canvas as HTMLElement).style.touchAction = "none";
    });

    // Prevent native scroll on the xterm-viewport and scrollable-element wrappers
    // which can intercept touch events on mobile before they reach .xterm-screen
    const viewport = term.element?.querySelector(
      ".xterm-viewport"
    ) as HTMLElement | null;
    if (viewport) {
      viewport.style.touchAction = "none";
      viewport.style.overflowY = "hidden";
    }
    const scrollableEl = term.element?.querySelector(
      ".xterm-scrollable-element"
    ) as HTMLElement | null;
    if (scrollableEl) {
      scrollableEl.style.touchAction = "none";
    }

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let scrollDirection: "vertical" | "horizontal" | null = null;
    let scrollAccumulator = 0;

    handleTouchStart = (e: TouchEvent) => {
      if (selectModeRef.current || e.touches.length === 0) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      scrollDirection = null;
      scrollAccumulator = 0;
    };

    handleTouchMove = (e: TouchEvent) => {
      if (selectModeRef.current || e.touches.length === 0) return;
      if (scrollDirection === null && startX === 0 && startY === 0) return;

      const touch = e.touches[0];

      if (scrollDirection === null) {
        const deltaX = Math.abs(touch.clientX - startX);
        const deltaY = Math.abs(touch.clientY - startY);
        if (deltaX > 8 || deltaY > 8) {
          scrollDirection = deltaX > deltaY ? "horizontal" : "vertical";
        }
      }

      if (scrollDirection === "horizontal") return;

      if (scrollDirection === "vertical") {
        e.preventDefault();
        e.stopPropagation();
      }

      const deltaY = touch.clientY - lastY;
      lastY = touch.clientY;

      if (Math.abs(deltaY) < 1) return;

      // Convert touch movement to synthetic WheelEvents on the xterm element.
      // This feeds into xterm's full event pipeline:
      //   - Normal buffer: SmoothScrollableElement handles wheel → viewport scrolls
      //   - Alternate buffer with mouse protocol (tmux mouse on): coreMouseService
      //     converts wheel to mouse escape sequences sent through the PTY properly
      scrollAccumulator += deltaY;
      const step = 20;

      while (Math.abs(scrollAccumulator) >= step) {
        // Negate: finger DOWN (positive deltaY) → scroll UP (negative wheel deltaY)
        const wheelDelta = scrollAccumulator > 0 ? -100 : 100;
        const syntheticWheel = new WheelEvent("wheel", {
          deltaY: wheelDelta,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          bubbles: true,
          cancelable: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
        xtermScreen.dispatchEvent(syntheticWheel);
        scrollAccumulator += scrollAccumulator > 0 ? -step : step;
      }
    };

    handleTouchEnd = () => {
      startX = 0;
      startY = 0;
      lastY = 0;
      scrollDirection = null;
      scrollAccumulator = 0;
    };
    handleTouchCancel = handleTouchEnd;

    xtermScreen.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    xtermScreen.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    xtermScreen.addEventListener("touchend", handleTouchEnd);
    xtermScreen.addEventListener("touchcancel", handleTouchCancel);

    touchElement = xtermScreen;
  };

  setupTouchScrollInner();

  return () => {
    if (setupTimeout) clearTimeout(setupTimeout);
    if (touchElement) {
      if (handleTouchStart)
        touchElement.removeEventListener("touchstart", handleTouchStart);
      if (handleTouchMove)
        touchElement.removeEventListener("touchmove", handleTouchMove);
      if (handleTouchEnd)
        touchElement.removeEventListener("touchend", handleTouchEnd);
      if (handleTouchCancel)
        touchElement.removeEventListener("touchcancel", handleTouchCancel);
    }
  };
}
