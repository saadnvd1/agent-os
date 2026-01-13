"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { TerminalToolbar } from "./TerminalToolbar";
import { useViewport } from "@/hooks/useViewport";

export interface TerminalHandle {
  sendCommand: (command: string) => void;
  sendInput: (data: string) => void;
  focus: () => void;
}

interface TerminalProps {
  onConnected?: () => void;
  onDisconnected?: () => void;
}

const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal({ onConnected, onDisconnected }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
    const { isMobile } = useViewport();

    // Store callbacks in refs so effect doesn't depend on them
    const callbacksRef = useRef({ onConnected, onDisconnected });
    callbacksRef.current = { onConnected, onDisconnected };

    useImperativeHandle(ref, () => ({
      sendCommand: (command: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "command", data: command }));
        }
      },
      sendInput: (data: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "input", data }));
        }
      },
      focus: () => {
        termRef.current?.focus();
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      // Create terminal
      const term = new XTerm({
        cursorBlink: true,
        fontSize,
        fontFamily: "ui-monospace, monospace",
        theme: {
          background: "#09090b",
          foreground: "#fafafa",
          cursor: "#10b981",
          cursorAccent: "#09090b",
          selectionBackground: "#27272a",
          black: "#09090b",
          red: "#ef4444",
          green: "#10b981",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#fafafa",
          brightBlack: "#52525b",
          brightRed: "#f87171",
          brightGreen: "#34d399",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(container);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Fit after a frame to ensure container has dimensions
      requestAnimationFrame(() => {
        fitAddon.fit();
      });

      // Connect WebSocket
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
      wsRef.current = ws;

      ws.onopen = () => {
        callbacksRef.current.onConnected?.();
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        // Auto-focus terminal when connected
        term.focus();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            term.write(msg.data);
          } else if (msg.type === "exit") {
            term.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
          }
        } catch {
          term.write(event.data);
        }
      };

      ws.onclose = () => {
        callbacksRef.current.onDisconnected?.();
      };

      ws.onerror = () => {
        // Silently ignore WebSocket errors - they're usually just connection issues
        // during page load or HMR that resolve on their own
      };

      // Handle terminal input
      const inputDisposable = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // Handle window resize
      const handleResize = () => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        }
      };
      window.addEventListener("resize", handleResize);

      // Handle touch gestures for mobile
      let lastScrollY = 0;
      let lastTouchDistance = 0;
      const SCROLL_THRESHOLD = 10; // Reduced from 15 for better responsiveness
      const touchElements: HTMLElement[] = [];

      const getTouchDistance = (e: TouchEvent): number => {
        if (e.touches.length !== 2) return 0;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const handleTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          // Single touch - for scrolling
          lastScrollY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          // Two fingers - for pinch-to-zoom
          lastTouchDistance = getTouchDistance(e);
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        // Prevent page scroll
        e.preventDefault();
        e.stopPropagation();

        // Safety check
        if (!termRef.current) return;

        if (e.touches.length === 1) {
          // Single touch - scroll
          const touchY = e.touches[0].clientY;
          const deltaY = lastScrollY - touchY;

          if (Math.abs(deltaY) >= SCROLL_THRESHOLD) {
            const lines = Math.floor(Math.abs(deltaY) / SCROLL_THRESHOLD);
            try {
              if (deltaY > 0) {
                termRef.current.scrollLines(lines);
              } else {
                termRef.current.scrollLines(-lines);
              }
            } catch {
              // Terminal might be in invalid state
            }
            lastScrollY = touchY;
          }
        } else if (e.touches.length === 2) {
          // Two fingers - pinch to zoom
          const currentDistance = getTouchDistance(e);
          const delta = currentDistance - lastTouchDistance;

          if (Math.abs(delta) > 10) {
            setFontSize(prev => {
              const newSize = delta > 0 ? prev + 1 : prev - 1;
              return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, newSize));
            });
            lastTouchDistance = currentDistance;
          }
        }
      };

      const handleTouchEnd = () => {
        lastTouchDistance = 0;
      };

      // Apply touch-action and attach listeners
      const applyTouchHandlers = (el: HTMLElement | null) => {
        if (!el) return;
        el.style.touchAction = "none";
        el.addEventListener("touchstart", handleTouchStart, { passive: true });
        el.addEventListener("touchmove", handleTouchMove, { passive: false });
        el.addEventListener("touchend", handleTouchEnd, { passive: true });
        touchElements.push(el);
      };

      // Attach to container
      applyTouchHandlers(container);

      // Attach to xterm internal elements
      requestAnimationFrame(() => {
        const selectors = [".xterm", ".xterm-viewport", ".xterm-screen", ".xterm-scrollable-element", ".xterm-rows"];
        selectors.forEach(sel => {
          const el = container.querySelector(sel) as HTMLElement | null;
          if (el && !touchElements.includes(el)) {
            applyTouchHandlers(el);
          }
        });
      });

      // Cleanup
      return () => {
        window.removeEventListener("resize", handleResize);
        touchElements.forEach(el => {
          el.removeEventListener("touchstart", handleTouchStart);
          el.removeEventListener("touchmove", handleTouchMove);
          el.removeEventListener("touchend", handleTouchEnd);
        });
        inputDisposable.dispose();
        ws.close();
        term.dispose();
        termRef.current = null;
        wsRef.current = null;
        fitAddonRef.current = null;
      };
    }, []);

    // Update terminal font size when state changes
    useEffect(() => {
      if (termRef.current) {
        termRef.current.options.fontSize = fontSize;
        fitAddonRef.current?.fit();
      }
    }, [fontSize]);

    // Handle keyboard viewport changes on mobile
    useEffect(() => {
      if (!isMobile || typeof window === "undefined") return;

      const handleViewportResize = () => {
        // When keyboard appears, visualViewport height decreases
        // Resize terminal to fit visible area
        if (fitAddonRef.current) {
          requestAnimationFrame(() => {
            fitAddonRef.current?.fit();
          });
        }
      };

      const viewport = window.visualViewport;
      if (viewport) {
        viewport.addEventListener("resize", handleViewportResize);
        return () => {
          viewport.removeEventListener("resize", handleViewportResize);
        };
      }
    }, [isMobile]);

    // Quick action handlers for toolbar
    const handleSendY = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data: "Y\r" }));
      }
    };

    const handleSendN = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data: "n\r" }));
      }
    };

    const handleSendEnter = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data: "\r" }));
      }
    };

    const handleSendCtrlC = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data: "\x03" }));
      }
    };

    const handleZoomIn = () => {
      setFontSize(prev => Math.min(MAX_FONT_SIZE, prev + 1));
    };

    const handleZoomOut = () => {
      setFontSize(prev => Math.max(MIN_FONT_SIZE, prev - 1));
    };

    const handleCopy = async () => {
      const selection = termRef.current?.getSelection();
      if (selection) {
        try {
          await navigator.clipboard.writeText(selection);
        } catch {
          // Clipboard API might fail on some devices
        }
      }
    };

    const handlePaste = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (wsRef.current?.readyState === WebSocket.OPEN && text) {
          wsRef.current.send(JSON.stringify({ type: "input", data: text }));
        }
      } catch {
        // Clipboard API might fail
      }
    };

    // Tap to focus keyboard (on mobile)
    const handleContainerTap = () => {
      if (isMobile) {
        termRef.current?.focus();
      }
    };

    return (
      <div className="h-full w-full flex flex-col">
        {/* Toolbar (mobile only) */}
        {isMobile && (
          <TerminalToolbar
            onSendY={handleSendY}
            onSendN={handleSendN}
            onSendEnter={handleSendEnter}
            onSendCtrlC={handleSendCtrlC}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onCopy={handleCopy}
            onPaste={handlePaste}
            fontSize={fontSize}
          />
        )}

        {/* Terminal */}
        <div
          ref={containerRef}
          onClick={handleContainerTap}
          className="flex-1 w-full overflow-hidden bg-zinc-950 px-1 touch-none"
        />
      </div>
    );
  }
);
