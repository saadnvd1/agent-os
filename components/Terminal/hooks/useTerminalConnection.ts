'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { CanvasAddon } from '@xterm/addon-canvas';
import {
  TERMINAL_THEME,
  WS_RECONNECT_BASE_DELAY,
  WS_RECONNECT_MAX_DELAY,
} from '../constants';

export interface TerminalScrollState {
  scrollTop: number;
  cursorY: number;
  baseY: number;
}

interface UseTerminalConnectionProps {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onBeforeUnmount?: (scrollState: TerminalScrollState) => void;
  initialScrollState?: TerminalScrollState;
  isMobile?: boolean;
}

export function useTerminalConnection({
  terminalRef,
  onConnected,
  onDisconnected,
  onBeforeUnmount,
  initialScrollState,
  isMobile = false,
}: UseTerminalConnectionProps) {
  const [connected, setConnected] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [connectionState, setConnectionState] = useState<
    'connected' | 'disconnected' | 'reconnecting'
  >('disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Reconnection tracking
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef<number>(WS_RECONNECT_BASE_DELAY);
  const intentionalCloseRef = useRef<boolean>(false);
  const isReconnectRef = useRef<boolean>(false);

  // Store callbacks in refs
  const callbacksRef = useRef({ onConnected, onDisconnected, onBeforeUnmount });
  callbacksRef.current = { onConnected, onDisconnected, onBeforeUnmount };

  // Store initial scroll state
  const initialScrollStateRef = useRef(initialScrollState);

  const scrollToBottom = useCallback(() => {
    xtermRef.current?.scrollToBottom();
  }, []);

  const copySelection = useCallback(() => {
    if (xtermRef.current) {
      const selection = xtermRef.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        return true;
      }
    }
    return false;
  }, []);

  // Send input to terminal
  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  }, []);

  // Send command (same as sendInput but adds newline)
  const sendCommand = useCallback((command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'command', data: command }));
    }
  }, []);

  // Focus terminal
  const focus = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  // Get scroll state
  const getScrollState = useCallback((): TerminalScrollState | null => {
    if (!xtermRef.current || !terminalRef.current) return null;
    const buffer = xtermRef.current.buffer.active;
    const viewport = terminalRef.current.querySelector('.xterm-viewport') as HTMLElement;
    return {
      scrollTop: viewport?.scrollTop ?? 0,
      cursorY: buffer.cursorY,
      baseY: buffer.baseY,
    };
  }, [terminalRef]);

  // Restore scroll state
  const restoreScrollState = useCallback((state: TerminalScrollState) => {
    if (!terminalRef.current) return;
    const viewport = terminalRef.current.querySelector('.xterm-viewport') as HTMLElement;
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTop = state.scrollTop;
      });
    }
  }, [terminalRef]);

  // Trigger terminal resize
  const triggerResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = xtermRef.current;
    if (!fitAddon || !term) return;

    fitAddon.fit();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, []);


  useEffect(() => {
    if (!terminalRef.current) return;

    let cancelled = false;
    let term: XTerm | null = null;
    let ws: WebSocket | null = null;
    let handleResize: (() => void) | null = null;
    let handleTouchStart: ((e: TouchEvent) => void) | null = null;
    let handleTouchMove: ((e: TouchEvent) => void) | null = null;
    let handleTouchEnd: ((e: TouchEvent) => void) | null = null;
    let handleTouchCancel: (() => void) | null = null;
    let touchElement: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mqListeners: { mq: MediaQueryList; handler: () => void }[] = [];
    let fitTimeouts: NodeJS.Timeout[] = [];

    const connectTimeout = setTimeout(() => {
      if (cancelled || !terminalRef.current) return;

      // Initialize xterm.js - smaller font for mobile
      const fontSize = isMobile ? 11 : 14;
      term = new XTerm({
        cursorBlink: true,
        fontSize,
        fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
        fontWeight: '400',
        fontWeightBold: '600',
        letterSpacing: 0,
        lineHeight: isMobile ? 1.15 : 1.2,
        scrollback: 15000,
        scrollSensitivity: isMobile ? 3 : 1,
        fastScrollSensitivity: 5,
        smoothScrollDuration: 100,
        cursorStyle: 'bar',
        cursorWidth: 2,
        allowProposedApi: true,
        theme: TERMINAL_THEME,
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.loadAddon(searchAddon);
      term.open(terminalRef.current);
      term.loadAddon(new CanvasAddon());
      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      // On mobile, prevent iOS keyboard from appearing by setting inputMode="none"
      // on xterm's hidden textarea. We use the virtual MobileKeybar instead.
      if (isMobile && term.element) {
        const textarea = term.element.querySelector('textarea');
        if (textarea) {
          textarea.setAttribute('inputmode', 'none');
          textarea.setAttribute('readonly', 'true');
        }
      }

      // Scroll tracking
      term.onScroll(() => {
        if (!term) return;
        const buffer = term.buffer.active;
        setIsAtBottom(buffer.viewportY >= buffer.baseY);
      });

      // Touch scroll handler - xterm.js canvas doesn't support native touch scroll
      if (term.element) {
        const currentTermForTouch = term;

        // Wait for .xterm-screen to be available
        const setupTouchScroll = () => {
          if (cancelled) return;

          const xtermScreen = currentTermForTouch.element?.querySelector(
            '.xterm-screen'
          ) as HTMLElement | null;
          if (!xtermScreen) {
            setTimeout(setupTouchScroll, 50);
            return;
          }

          // CRITICAL: Apply touch-action directly to the target element
          xtermScreen.style.touchAction = 'none';
          xtermScreen.style.userSelect = 'none';
          (xtermScreen.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';

          // Also apply to canvas children
          const canvases = xtermScreen.querySelectorAll('canvas');
          canvases.forEach((canvas) => {
            (canvas as HTMLElement).style.touchAction = 'none';
          });

          let lastTouchY: number | null = null;
          let initialTouchY: number | null = null;

          handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length > 0) {
              lastTouchY = e.touches[0].clientY;
              initialTouchY = e.touches[0].clientY;
            }
          };

          handleTouchMove = (e: TouchEvent) => {
            if (lastTouchY === null || e.touches.length === 0) return;

            e.preventDefault();
            e.stopPropagation();

            const currentY = e.touches[0].clientY;
            const deltaY = currentY - lastTouchY;

            if (Math.abs(deltaY) < 25) return;

            const buffer = currentTermForTouch.buffer.active;
            const isAlternateBuffer = buffer.type === 'alternate';

            if (isAlternateBuffer && wsRef.current?.readyState === WebSocket.OPEN) {
              const wheelEvent = deltaY < 0
                ? '\x1b[<65;1;1M'
                : '\x1b[<64;1;1M';
              wsRef.current.send(JSON.stringify({ type: 'input', data: wheelEvent }));
              lastTouchY = currentY;
            } else if (!isAlternateBuffer) {
              const scrollAmount = Math.round(deltaY / 15);
              if (scrollAmount !== 0) {
                currentTermForTouch.scrollLines(scrollAmount);
                lastTouchY = currentY;
              }
            }
          };

          handleTouchEnd = () => {
            // Don't focus on tap - use the virtual MobileKeybar instead
            // This prevents the iOS keyboard from popping up
            lastTouchY = null;
            initialTouchY = null;
          };

          handleTouchCancel = () => {
            lastTouchY = null;
            initialTouchY = null;
          };

          xtermScreen.addEventListener('touchstart', handleTouchStart, { passive: true });
          xtermScreen.addEventListener('touchmove', handleTouchMove, { passive: false });
          xtermScreen.addEventListener('touchend', handleTouchEnd);
          xtermScreen.addEventListener('touchcancel', handleTouchCancel);

          touchElement = xtermScreen;
        };

        setupTouchScroll();
      }

      // WebSocket connection
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
      wsRef.current = ws;
      const currentTerm = term;
      const currentWs = ws;

      currentWs.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setConnectionState('connected');
        reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;

        callbacksRef.current.onConnected?.();
        currentWs.send(
          JSON.stringify({ type: 'resize', cols: currentTerm.cols, rows: currentTerm.rows })
        );
        currentTerm.focus();

        // Restore scroll state if provided
        if (initialScrollStateRef.current && terminalRef.current) {
          setTimeout(() => {
            const viewport = terminalRef.current?.querySelector('.xterm-viewport') as HTMLElement;
            if (viewport) {
              viewport.scrollTop = initialScrollStateRef.current!.scrollTop;
            }
          }, 200);
        }
      };

      currentWs.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'output') {
            currentTerm.write(msg.data);
          } else if (msg.type === 'exit') {
            currentTerm.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
          }
        } catch {
          currentTerm.write(event.data);
        }
      };

      currentWs.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        callbacksRef.current.onDisconnected?.();

        if (intentionalCloseRef.current) {
          setConnectionState('disconnected');
          return;
        }

        setConnectionState('disconnected');

        const currentDelay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(currentDelay * 2, WS_RECONNECT_MAX_DELAY);

        reconnectTimeoutRef.current = setTimeout(() => {
          if (cancelled || intentionalCloseRef.current) return;
          setConnectionState('reconnecting');
          isReconnectRef.current = true;

          const newWs = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
          ws = newWs;
          wsRef.current = newWs;
          newWs.onopen = currentWs.onopen;
          newWs.onmessage = currentWs.onmessage;
          newWs.onclose = currentWs.onclose;
          newWs.onerror = currentWs.onerror;
        }, currentDelay);
      };

      currentWs.onerror = () => {
        if (cancelled) return;
      };

      currentTerm.onData((data) => {
        const activeWs = wsRef.current;
        if (activeWs?.readyState === WebSocket.OPEN) {
          activeWs.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Handle Shift+Enter to send newline without carriage return
      // This allows multi-line input in Claude Code CLI
      currentTerm.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
          // Send soft newline (just \n, not \r)
          const activeWs = wsRef.current;
          if (activeWs?.readyState === WebSocket.OPEN) {
            activeWs.send(JSON.stringify({ type: 'input', data: '\n' }));
          }
          return false; // Prevent default Enter handling
        }
        return true; // Allow all other keys
      });

      // Debounced resize handler with triple-fit pattern for reliability
      let resizeTimeout: NodeJS.Timeout | null = null;

      const doFit = () => {
        // Clear any pending fit timeouts
        fitTimeouts.forEach(clearTimeout);
        fitTimeouts = [];

        requestAnimationFrame(() => {
          // First fit - immediate
          fitAddon.fit();

          const sendResize = () => {
            const activeWs = wsRef.current;
            if (activeWs?.readyState === WebSocket.OPEN) {
              activeWs.send(
                JSON.stringify({ type: 'resize', cols: currentTerm.cols, rows: currentTerm.rows })
              );
            }
          };

          sendResize();

          // Second fit - after 100ms (handles most delayed layout updates)
          fitTimeouts.push(setTimeout(() => {
            fitAddon.fit();
            sendResize();
          }, 100));

          // Third fit - after 250ms (handles slow layout updates, e.g., DevTools toggle)
          fitTimeouts.push(setTimeout(() => {
            fitAddon.fit();
            sendResize();
          }, 250));
        });
      };

      handleResize = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(doFit, isMobile ? 100 : 50);
      };
      window.addEventListener('resize', handleResize);

      // Media query listeners for Chrome DevTools mobile toggle
      // DevTools doesn't trigger window.resize but DOES trigger matchMedia
      const mediaQueries = [
        '(max-width: 640px)',
        '(max-width: 768px)',
        '(max-width: 1024px)',
      ];
      mediaQueries.forEach(query => {
        const mq = window.matchMedia(query);
        const handler = () => handleResize?.();
        mq.addEventListener('change', handler);
        mqListeners.push({ mq, handler });
      });

      // Handle orientation change on mobile
      if (isMobile && 'orientation' in screen) {
        screen.orientation.addEventListener('change', handleResize);
      }

      // Handle visual viewport changes (for mobile keyboard)
      if (isMobile && window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
      }

      // Use ResizeObserver
      resizeObserver = new ResizeObserver(() => {
        handleResize?.();
      });
      resizeObserver.observe(terminalRef.current);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(connectTimeout);
      intentionalCloseRef.current = true;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
      isReconnectRef.current = false;

      if (handleResize) {
        window.removeEventListener('resize', handleResize);
        if (isMobile && 'orientation' in screen) {
          screen.orientation.removeEventListener('change', handleResize);
        }
        if (isMobile && window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleResize);
        }
      }

      // Clean up media query listeners
      mqListeners.forEach(({ mq, handler }) => {
        mq.removeEventListener('change', handler);
      });

      // Clean up pending fit timeouts
      fitTimeouts.forEach(clearTimeout);

      if (touchElement) {
        if (handleTouchStart) touchElement.removeEventListener('touchstart', handleTouchStart);
        if (handleTouchMove) touchElement.removeEventListener('touchmove', handleTouchMove);
        if (handleTouchEnd) touchElement.removeEventListener('touchend', handleTouchEnd);
        if (handleTouchCancel) touchElement.removeEventListener('touchcancel', handleTouchCancel);
      }

      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }

      // Save scroll state before unmount
      if (term && callbacksRef.current.onBeforeUnmount && terminalRef.current) {
        const buffer = term.buffer.active;
        const viewport = terminalRef.current.querySelector('.xterm-viewport') as HTMLElement;
        callbacksRef.current.onBeforeUnmount({
          scrollTop: viewport?.scrollTop ?? 0,
          cursorY: buffer.cursorY,
          baseY: buffer.baseY,
        });
      }

      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'Component unmounting');
      }

      if (wsRef.current === ws) wsRef.current = null;
      if (term) {
        try {
          term.dispose();
        } catch { /* ignore */ }
      }
      if (xtermRef.current === term) xtermRef.current = null;
      if (fitAddonRef.current) fitAddonRef.current = null;
      if (searchAddonRef.current) searchAddonRef.current = null;
    };
  }, [isMobile, terminalRef]);

  // Handle isMobile changes dynamically
  useEffect(() => {
    const term = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    const newFontSize = isMobile ? 11 : 14;
    const newLineHeight = isMobile ? 1.15 : 1.2;

    if (term.options.fontSize !== newFontSize) {
      term.options.fontSize = newFontSize;
      term.options.lineHeight = newLineHeight;
      term.refresh(0, term.rows - 1);
      fitAddon.fit();

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }
  }, [isMobile]);

  return {
    connected,
    connectionState,
    isAtBottom,
    xtermRef,
    searchAddonRef,
    scrollToBottom,
    copySelection,
    sendInput,
    sendCommand,
    focus,
    getScrollState,
    restoreScrollState,
    triggerResize,
  };
}
