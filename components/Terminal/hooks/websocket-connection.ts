'use client';

import type { Terminal as XTerm } from '@xterm/xterm';
import { WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from '../constants';

export interface WebSocketCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onConnectionStateChange: (state: 'connected' | 'disconnected' | 'reconnecting') => void;
  onSetConnected: (connected: boolean) => void;
}

export interface WebSocketManager {
  ws: WebSocket;
  sendInput: (data: string) => void;
  sendCommand: (command: string) => void;
  sendResize: (cols: number, rows: number) => void;
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
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
  wsRef.current = ws;

  const sendResize = (cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  };

  const sendInput = (data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
    }
  };

  const sendCommand = (command: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'command', data: command }));
    }
  };

  const attemptReconnect = () => {
    if (intentionalCloseRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    callbacks.onConnectionStateChange('reconnecting');

    const newWs = new WebSocket(`${protocol}//${window.location.host}/ws/terminal`);
    wsRef.current = newWs;
    newWs.onopen = ws.onopen;
    newWs.onmessage = ws.onmessage;
    newWs.onclose = ws.onclose;
    newWs.onerror = ws.onerror;
  };

  ws.onopen = () => {
    callbacks.onSetConnected(true);
    callbacks.onConnectionStateChange('connected');
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    callbacks.onConnected?.();
    sendResize(term.cols, term.rows);
    term.focus();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
      }
    } catch {
      term.write(event.data);
    }
  };

  ws.onclose = () => {
    callbacks.onSetConnected(false);
    callbacks.onDisconnected?.();

    if (intentionalCloseRef.current) {
      callbacks.onConnectionStateChange('disconnected');
      return;
    }

    callbacks.onConnectionStateChange('disconnected');

    const currentDelay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(currentDelay * 2, WS_RECONNECT_MAX_DELAY);
    reconnectTimeoutRef.current = setTimeout(attemptReconnect, currentDelay);
  };

  ws.onerror = () => {
    // Errors are handled by onclose
  };

  // Handle terminal input
  term.onData((data) => {
    sendInput(data);
  });

  // Handle Shift+Enter for multi-line input
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
      sendInput('\n');
      return false;
    }
    return true;
  });

  // Handle visibility change for reconnection
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || intentionalCloseRef.current) return;

    const currentWs = wsRef.current;
    const isDisconnected = !currentWs || currentWs.readyState === WebSocket.CLOSED || currentWs.readyState === WebSocket.CLOSING;
    const isStaleConnection = currentWs?.readyState === WebSocket.CONNECTING;

    if (!isDisconnected && !isStaleConnection) return;

    // Force close any stale connection
    if (isStaleConnection && currentWs) {
      try { currentWs.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }

    // Clear pending reconnect and reconnect immediately
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectDelayRef.current = WS_RECONNECT_BASE_DELAY;
    attemptReconnect();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const cleanup = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const currentWs = wsRef.current;
    if (currentWs && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
      currentWs.close(1000, 'Component unmounting');
    }
  };

  return { ws, sendInput, sendCommand, sendResize, cleanup };
}
