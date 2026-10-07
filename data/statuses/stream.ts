import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SessionStatus } from "@/components/views/types";
import { statusKeys } from "../sessions/keys";

interface StatusMessage {
  type: "statuses";
  statuses: Record<string, SessionStatus>;
}

const MAX_BACKOFF_MS = 30000;

// The server pushes the whole status map on connect and whenever a session
// changes state (/ws/status), straight into the status query's cache. Says
// whether the stream is up, so polling can slow down while it is.
export function useStatusStream(): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/status`);
      ws.onopen = () => {
        backoff = 1000;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        try {
          const m = JSON.parse(event.data) as StatusMessage;
          if (m.type === "statuses")
            queryClient.setQueryData(statusKeys.all, { statuses: m.statuses });
        } catch {
          // A message this build doesn't understand.
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };
    connect();

    // Phones drop sockets in the background: reconnect on return.
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        ws &&
        ws.readyState > WebSocket.OPEN
      ) {
        clearTimeout(retry);
        backoff = 1000;
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [queryClient]);

  return connected;
}

// A message just went to a chat: show it working before the server says so.
export function markRunning(queryClient: QueryClient, sessionId: string) {
  queryClient.setQueryData<{ statuses: Record<string, SessionStatus> }>(
    statusKeys.all,
    (old) => {
      const current = old?.statuses[sessionId];
      if (!old || !current) return old;
      return {
        ...old,
        statuses: {
          ...old.statuses,
          [sessionId]: { ...current, status: "running", need: null },
        },
      };
    }
  );
}
