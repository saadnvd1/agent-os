// A WebSocket that reconnects with backoff and comes straight back when the
// app returns to the foreground. Messages are JSON both ways.
import { AppState, type AppStateStatus } from "react-native";
import { backoffMs } from "./backoff";

export type SocketState = "connecting" | "open" | "closed";

export interface SocketOptions<In> {
  url: string;
  headers: Record<string, string>;
  onMessage: (msg: In) => void;
  onState?: (state: SocketState) => void;
  // Called once after a few failed attempts in a row: time to try another address.
  onStuck?: () => void;
}

type NativeSocket = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers: Record<string, string> }
) => WebSocket;

export function openSocket<In, Out = unknown>(opts: SocketOptions<In>) {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = null;
    opts.onState?.("connecting");
    const socket = new (WebSocket as unknown as NativeSocket)(opts.url, null, {
      headers: opts.headers,
    });
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      opts.onState?.("open");
    };
    socket.onmessage = (e) => {
      try {
        opts.onMessage(JSON.parse(String(e.data)) as In);
      } catch {
        // A frame we can't read is skipped, not fatal.
      }
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      opts.onState?.("closed");
      if (stopped) return;
      if (attempt === 2) opts.onStuck?.();
      timer = setTimeout(connect, backoffMs(attempt++));
    };
  };

  const onAppState = (state: AppStateStatus) => {
    if (state === "active" && !ws) {
      attempt = 0;
      connect();
    }
  };
  const sub = AppState.addEventListener("change", onAppState);
  connect();

  return {
    send(msg: Out): boolean {
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    reconnect() {
      attempt = 0;
      const old = ws;
      ws = null;
      old?.close();
      connect();
    },
    close() {
      stopped = true;
      sub.remove();
      if (timer) clearTimeout(timer);
      const old = ws;
      ws = null;
      old?.close();
    },
  };
}
