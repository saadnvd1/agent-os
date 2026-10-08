import { useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SessionStatus } from "@/components/views/types";
import type { LoadView } from "@/lib/load/monitor";
import { statusKeys } from "../sessions/keys";
import { loadKeys } from "../load";
import { ALL_TOPICS, invalidateTopics } from "../push/topics";
import { setPushConnected } from "../push/connection";
import { onWatchedGitDirs, watchedGitDirs } from "../git/watch";

type Statuses = Record<string, SessionStatus>;

// The numbered stream (lib/status/stream.ts).
type StreamMessage =
  | { type: "snapshot"; epoch: string; seq: number; statuses: Statuses }
  | {
      type: "statuses";
      seq: number;
      changed: Statuses;
      removed: string[];
    }
  | { type: "changed"; seq: number; topics: string[] }
  | { type: "load"; load: LoadView }
  | { type: "ping" };

const MAX_BACKOFF_MS = 30000;
// The server pings every 25s: a socket silent for longer than this is dead
// even if the browser still says it's open (a phone that changed networks
// while asleep), and so is one that comes back from being hidden this long.
const SILENT_MS = 60000;
const HIDDEN_MS = 15000;

// Where a stream left off, applied to the statuses it knew: the next state,
// or "resync" when a message was missed.
export function applyStreamMessage(
  position: { epoch: string; seq: number } | null,
  statuses: Statuses | undefined,
  m: StreamMessage
):
  | { position: { epoch: string; seq: number }; statuses?: Statuses }
  | "resync"
  | null {
  if (m.type === "snapshot")
    return { position: { epoch: m.epoch, seq: m.seq }, statuses: m.statuses };
  if (m.type === "load" || m.type === "ping") return null;
  if (!position || m.seq !== position.seq + 1) return "resync";
  const next = { epoch: position.epoch, seq: m.seq };
  if (m.type === "changed") return { position: next };
  const merged = { ...(statuses ?? {}), ...m.changed };
  for (const id of m.removed) delete merged[id];
  return { position: next, statuses: merged };
}

// Session statuses and what changed, pushed over /ws/status: statuses go
// straight into their query's cache, changed topics refetch the queries that
// show them (data/push/topics). A reconnect picks up where it left off, or
// takes a fresh snapshot and refetches what's on screen. Says whether the
// stream is up.
export function useStatusStream(): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let position: { epoch: string; seq: number } | null = null;
    // Set once a stream has been up: a later snapshot may have skipped
    // changes, so what's shown is refetched.
    let hadStream = false;
    let openedAt = 0;
    let heardAt = Date.now();

    const sendWatched = (sock: WebSocket) => {
      if (sock.readyState === WebSocket.OPEN)
        sock.send(
          JSON.stringify({ type: "watch_git", dirs: watchedGitDirs() })
        );
    };

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const resume = position
        ? `&epoch=${encodeURIComponent(position.epoch)}&seq=${position.seq}`
        : "";
      const sock = new WebSocket(
        `${protocol}//${window.location.host}/ws/status?v=2${resume}`
      );
      ws = sock;
      // A socket that's been replaced says nothing more.
      sock.onopen = () => {
        if (ws !== sock) return;
        backoff = 1000;
        openedAt = heardAt = Date.now();
        setConnected(true);
        setPushConnected(true);
        sendWatched(sock);
      };
      sock.onmessage = (event) => {
        if (ws !== sock) return;
        heardAt = Date.now();
        let m: StreamMessage;
        try {
          m = JSON.parse(event.data) as StreamMessage;
        } catch {
          return;
        }
        if (m.type === "load") {
          queryClient.setQueryData(loadKeys.all, m.load);
          return;
        }
        const current = queryClient.getQueryData<{ statuses: Statuses }>(
          statusKeys.all
        );
        const next = applyStreamMessage(position, current?.statuses, m);
        if (next === null) return;
        if (next === "resync") {
          // A gap: start over from a snapshot.
          position = null;
          sock.close();
          return;
        }
        position = next.position;
        if (next.statuses)
          queryClient.setQueryData(statusKeys.all, { statuses: next.statuses });
        if (m.type === "changed") invalidateTopics(queryClient, m.topics);
        // A snapshot means nothing was replayed: what's shown may have
        // changed unseen. The first one only redoes fetches that finished
        // before the stream could have told of a change.
        if (m.type === "snapshot")
          invalidateTopics(
            queryClient,
            [...ALL_TOPICS, ...watchedGitDirs().map((d) => `git:${d}`)],
            hadStream ? undefined : openedAt
          );
        hadStream = true;
      };
      sock.onclose = () => {
        if (closed || ws !== sock) return;
        setConnected(false);
        setPushConnected(false);
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };
    // Replaces the socket now; its place in the stream is kept, so the new
    // one resumes.
    const reconnect = () => {
      const old = ws;
      ws = null;
      old?.close();
      clearTimeout(retry);
      backoff = 1000;
      setConnected(false);
      setPushConnected(false);
      connect();
    };
    connect();
    const stopWatching = onWatchedGitDirs(() => ws && sendWatched(ws));
    const watchdog = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN && Date.now() - heardAt > SILENT_MS)
        reconnect();
    }, 10000);

    // Phones drop sockets in the background, or keep ones that died: on
    // return, reconnect unless it's plainly fine.
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt > 0 && Date.now() - hiddenAt > HIDDEN_MS;
      hiddenAt = 0;
      if (ws && (ws.readyState > WebSocket.OPEN || away)) reconnect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(watchdog);
      stopWatching();
      setPushConnected(false);
      document.removeEventListener("visibilitychange", onVisible);
      const old = ws;
      ws = null;
      old?.close();
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
