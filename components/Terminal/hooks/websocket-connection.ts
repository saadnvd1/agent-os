"use client";

import type { Terminal as XTerm } from "@xterm/xterm";
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from "../constants";
import type { AttachSpec } from "@/lib/hosts/attach";

export interface WebSocketCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onConnectionStateChange: (
    state: "connecting" | "connected" | "disconnected" | "reconnecting"
  ) => void;
  onSetConnected: (connected: boolean) => void;
}

export interface WebSocketManager {
  ws: WebSocket;
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  attach: (spec: AttachSpec) => void;
  sendResize: (cols: number, rows: number) => void;
  reconnect: () => void;
  cleanup: () => void;
}

export function createWebSocketConnection(
  term: XTerm,
  callbacks: WebSocketCallbacks,
  wsRef: React.MutableRefObject<WebSocket | null>,
  reconnectTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>,
  reconnectDelayRef: React.MutableRefObject<number>,
  intentionalCloseRef: React.MutableRefObject<boolean>
): WebSocketManager {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // flow=1: each output message is acked once written, and the server holds
  // back while too many are unacked (lib/terminal/shared-attach).
  const url = `${protocol}//${window.location.host}/ws/terminal?flow=1`;
  const ws = new WebSocket(url);
  wsRef.current = ws;

  const sendResize = (cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  };

  const sendInput = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  };

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "command", data: command }));
    }
  };

  const attach = (spec: AttachSpec) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "attach", spec }));
    }
  };

  // Force reconnect - kills any existing connection and creates fresh one
  // Note: savedHandlers is defined below, after the handlers it captures
  const forceReconnect = () => {
    if (intentionalCloseRef.current) return;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Force close existing socket regardless of state (handles hung sockets)
    const oldWs = wsRef.current;
    if (oldWs) {
      // Remove handlers to prevent callbacks
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try {
        oldWs.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    callbacks.onConnectionStateChange("reconnecting");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;

    // Create fresh connection with saved handlers
    const newWs = new WebSocket(url);
    wsRef.current = newWs;
    newWs.onopen = savedHandlers.onopen;
    newWs.onmessage = savedHandlers.onmessage;
    newWs.onclose = savedHandlers.onclose;
    newWs.onerror = savedHandlers.onerror;
  };

  // Soft reconnect - only if not already connected
  const attemptReconnect = () => {
    if (intentionalCloseRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    forceReconnect();
  };

  ws.onopen = () => {
    callbacks.onSetConnected(true);
    callbacks.onConnectionStateChange("connected");
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    callbacks.onConnected?.();
    sendResize(term.cols, term.rows);
    term.focus();
  };

  // Fight against Claude Code's forced top-scrolling bug
  // See: https://github.com/anthropics/claude-code/issues/826
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "output") {
        const buffer = term.buffer.active;
        const scrollYBefore = buffer.viewportY;
        const wasAtTop = scrollYBefore <= 0;
        const wasAtBottom = scrollYBefore >= buffer.baseY;

        // Acked once xterm has taken it: a phone that can't keep up slows
        // the stream instead of piling it up.
        const from = event.target as WebSocket;
        term.write(msg.data, () => {
          if (from.readyState === WebSocket.OPEN)
            from.send(JSON.stringify({ type: "ack" }));
        });

        // After write, check if scroll jumped to top unexpectedly
        // Give it a moment for the write to complete
        requestAnimationFrame(() => {
          const scrollYAfter = term.buffer.active.viewportY;
          const isNowAtTop = scrollYAfter <= 0;

          // If we jumped to top but weren't at top before, and weren't at bottom
          // (at bottom means we want to follow output), restore position
          if (isNowAtTop && !wasAtTop && !wasAtBottom && scrollYBefore > 5) {
            term.scrollToLine(scrollYBefore);
          }
        });
      } else if (msg.type === "detached") {
        term.write("\r\n\x1b[33m[detached]\x1b[0m\r\n");
      } else if (msg.type === "exit") {
        term.write("\r\n\x1b[33m[Session ended]\x1b[0m\r\n");
      }
    } catch {
      term.write(event.data);
    }
  };

  ws.onclose = () => {
    callbacks.onSetConnected(false);
    callbacks.onDisconnected?.();

    if (intentionalCloseRef.current) {
      callbacks.onConnectionStateChange("disconnected");
      return;
    }

    callbacks.onConnectionStateChange("disconnected");

    const currentDelay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(
      currentDelay * 2,
      WS_RECONNECT_MAX_DELAY
    );
    reconnectTimeoutRef.current = setTimeout(attemptReconnect, currentDelay);
  };

  ws.onerror = () => {
    // Errors are handled by onclose
  };

  // Save handlers now that they're defined (for reconnection)
  const savedHandlers = {
    onopen: ws.onopen,
    onmessage: ws.onmessage,
    onclose: ws.onclose,
    onerror: ws.onerror,
  };

  // Handle terminal input
  term.onData((data) => {
    sendInput(data);
  });

  // Handle Shift+Enter for multi-line input
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown" && event.key === "Enter" && event.shiftKey) {
      sendInput("\n");
      return false;
    }
    return true;
  });

  // Track when page was last hidden (for detecting long sleeps)
  let hiddenAt: number | null = null;

  // Handle visibility change for reconnection
  const handleVisibilityChange = () => {
    if (intentionalCloseRef.current) return;

    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }

    // Page became visible
    if (document.visibilityState !== "visible") return;

    const wasHiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;

    // If hidden for more than 5 seconds, force reconnect (iOS Safari kills sockets)
    // This handles the "hung socket" problem where readyState says OPEN but it's dead
    if (wasHiddenFor > 5000) {
      forceReconnect();
      return;
    }

    // Otherwise only reconnect if actually disconnected
    const currentWs = wsRef.current;
    const isDisconnected =
      !currentWs ||
      currentWs.readyState === WebSocket.CLOSED ||
      currentWs.readyState === WebSocket.CLOSING;
    const isStaleConnection = currentWs?.readyState === WebSocket.CONNECTING;

    if (isDisconnected || isStaleConnection) {
      forceReconnect();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  const cleanup = () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const currentWs = wsRef.current;
    if (
      currentWs &&
      (currentWs.readyState === WebSocket.OPEN ||
        currentWs.readyState === WebSocket.CONNECTING)
    ) {
      currentWs.close(1000, "Component unmounting");
    }
  };

  return {
    ws,
    sendInput,
    sendCommand,
    attach,
    sendResize,
    reconnect: forceReconnect,
    cleanup,
  };
}
