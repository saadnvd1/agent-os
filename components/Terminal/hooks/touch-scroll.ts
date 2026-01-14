'use client';

import type { Terminal as XTerm } from '@xterm/xterm';
import type { RefObject } from 'react';

interface TouchScrollConfig {
  term: XTerm;
  selectModeRef: RefObject<boolean>;
  wsRef: RefObject<WebSocket | null>;
}

export function setupTouchScroll(config: TouchScrollConfig): () => void {
  const { term, selectModeRef, wsRef } = config;

  if (!term.element) return () => {};

  let touchElement: HTMLElement | null = null;
  let handleTouchStart: ((e: TouchEvent) => void) | null = null;
  let handleTouchMove: ((e: TouchEvent) => void) | null = null;
  let handleTouchEnd: (() => void) | null = null;
  let handleTouchCancel: (() => void) | null = null;
  let setupTimeout: NodeJS.Timeout | null = null;

  const setupTouchScrollInner = () => {
    const xtermScreen = term.element?.querySelector('.xterm-screen') as HTMLElement | null;
    if (!xtermScreen) {
      setupTimeout = setTimeout(setupTouchScrollInner, 50);
      return;
    }

    // Apply touch-action to prevent browser handling
    xtermScreen.style.touchAction = 'none';
    xtermScreen.style.userSelect = 'none';
    (xtermScreen.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';

    // Also apply to canvas children
    const canvases = xtermScreen.querySelectorAll('canvas');
    canvases.forEach((canvas) => {
      (canvas as HTMLElement).style.touchAction = 'none';
    });

    // Touch state for scroll handling
    let touchState = {
      lastY: null as number | null,
      initialX: null as number | null,
      initialY: null as number | null,
      isHorizontal: null as boolean | null,
    };

    const resetTouchState = () => {
      touchState = { lastY: null, initialX: null, initialY: null, isHorizontal: null };
    };

    handleTouchStart = (e: TouchEvent) => {
      if (selectModeRef.current || e.touches.length === 0) return;
      const touch = e.touches[0];
      touchState = {
        lastY: touch.clientY,
        initialX: touch.clientX,
        initialY: touch.clientY,
        isHorizontal: null,
      };
    };

    handleTouchMove = (e: TouchEvent) => {
      if (selectModeRef.current || e.touches.length === 0) return;
      const { lastY, initialX, initialY, isHorizontal } = touchState;
      if (lastY === null || initialX === null || initialY === null) return;

      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - initialX);
      const deltaY = Math.abs(touch.clientY - initialY);

      // Determine swipe direction on first significant movement
      if (isHorizontal === null && (deltaX > 15 || deltaY > 15)) {
        touchState.isHorizontal = deltaX > deltaY;
      }

      // Let parent handle horizontal swipes for session switching
      if (touchState.isHorizontal) return;

      e.preventDefault();
      e.stopPropagation();

      const moveDeltaY = touch.clientY - lastY;
      if (Math.abs(moveDeltaY) < 25) return;

      const buffer = term.buffer.active;

      if (buffer.type === 'alternate' && wsRef.current?.readyState === WebSocket.OPEN) {
        // Send mouse wheel events for alternate buffer (e.g., less, vim)
        const wheelEvent = moveDeltaY < 0 ? '\x1b[<65;1;1M' : '\x1b[<64;1;1M';
        wsRef.current.send(JSON.stringify({ type: 'input', data: wheelEvent }));
        touchState.lastY = touch.clientY;
      } else if (buffer.type !== 'alternate') {
        const scrollAmount = Math.round(moveDeltaY / 15);
        if (scrollAmount !== 0) {
          term.scrollLines(scrollAmount);
          touchState.lastY = touch.clientY;
        }
      }
    };

    handleTouchEnd = resetTouchState;
    handleTouchCancel = resetTouchState;

    xtermScreen.addEventListener('touchstart', handleTouchStart, { passive: true });
    xtermScreen.addEventListener('touchmove', handleTouchMove, { passive: false });
    xtermScreen.addEventListener('touchend', handleTouchEnd);
    xtermScreen.addEventListener('touchcancel', handleTouchCancel);

    touchElement = xtermScreen;
  };

  setupTouchScrollInner();

  // Return cleanup function
  return () => {
    if (setupTimeout) clearTimeout(setupTimeout);
    if (touchElement) {
      if (handleTouchStart) touchElement.removeEventListener('touchstart', handleTouchStart);
      if (handleTouchMove) touchElement.removeEventListener('touchmove', handleTouchMove);
      if (handleTouchEnd) touchElement.removeEventListener('touchend', handleTouchEnd);
      if (handleTouchCancel) touchElement.removeEventListener('touchcancel', handleTouchCancel);
    }
  };
}
