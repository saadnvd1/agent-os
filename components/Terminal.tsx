"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  sendCommand: (command: string) => void;
  sendInput: (data: string) => void;
  focus: () => void;
}

interface TerminalProps {
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  function Terminal({ onConnected, onDisconnected }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

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
        fontSize: 14,
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

      // Handle touch scrolling for mobile
      // xterm creates nested elements, attach to all of them
      let lastScrollY = 0;
      const SCROLL_THRESHOLD = 15; // pixels to trigger a scroll line
      const touchElements: HTMLElement[] = [];

      const handleTouchStart = (e: TouchEvent) => {
        lastScrollY = e.touches[0].clientY;
      };

      const handleTouchMove = (e: TouchEvent) => {
        // Prevent page scroll
        e.preventDefault();
        e.stopPropagation();

        // Safety check - terminal might be disposed
        if (!termRef.current) return;

        const touchY = e.touches[0].clientY;
        const deltaY = lastScrollY - touchY;

        // Convert touch movement to scroll lines
        if (Math.abs(deltaY) >= SCROLL_THRESHOLD) {
          const lines = Math.floor(Math.abs(deltaY) / SCROLL_THRESHOLD);
          try {
            if (deltaY > 0) {
              // Scrolling up (finger moving up) - scroll terminal down
              termRef.current.scrollLines(lines);
            } else {
              // Scrolling down (finger moving down) - scroll terminal up
              termRef.current.scrollLines(-lines);
            }
          } catch {
            // Terminal might be in invalid state, ignore
          }
          lastScrollY = touchY;
        }
      };

      // Apply touch-action and attach listeners to all xterm elements
      const applyTouchHandlers = (el: HTMLElement | null) => {
        if (!el) return;
        el.style.touchAction = "none";
        el.addEventListener("touchstart", handleTouchStart, { passive: true });
        el.addEventListener("touchmove", handleTouchMove, { passive: false });
        touchElements.push(el);
      };

      // Attach to container
      applyTouchHandlers(container);

      // Attach to all xterm internal elements after a frame (to ensure they exist)
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
        });
        inputDisposable.dispose();
        ws.close();
        term.dispose();
        termRef.current = null;
        wsRef.current = null;
        fitAddonRef.current = null;
      };
    }, []); // Empty deps - this effect runs once on mount

    return (
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden bg-zinc-950 px-1 touch-none"
      />
    );
  }
);
