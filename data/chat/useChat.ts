"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { markRunning } from "../statuses/stream";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatCommand,
  ChatContext,
  ChatImage,
  ChatItem,
  ChatModel,
  ChatServerMessage,
  ChatState,
  FileSuggestion,
  QueuedMessage,
  ToolBody,
  UndoPreview,
} from "@/lib/chat/events";

// The index of the item with `id`, searched from the end: what changes is
// almost always the latest.
function lastIndexOfId(items: ChatItem[], id: string): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].id === id) return i;
  return -1;
}

// Streamed text for several items, applied in one pass.
export function applyDeltas(
  items: ChatItem[],
  deltas: Map<string, string>
): ChatItem[] {
  let next: ChatItem[] | null = null;
  for (const [id, text] of deltas) {
    const i = lastIndexOfId(next ?? items, id);
    if (i === -1) continue;
    const item = (next ?? items)[i];
    if (!("text" in item)) continue;
    next ??= items.slice();
    next[i] = { ...item, text: item.text + text } as ChatItem;
  }
  return next ?? items;
}

// A fresh page after a reconnect, joined to the older items already loaded
// when it overlaps them.
export function joinPage(
  prev: ChatItem[],
  page: ChatItem[]
): ChatItem[] | null {
  if (!page.length) return null;
  const at = prev.findIndex((p) => p.id === page[0].id);
  return at > 0 ? prev.slice(0, at).concat(page) : null;
}

// One chat conversation over its WebSocket: a snapshot, then live items and
// streamed text. Reconnects when the socket drops (e.g. a phone waking up).
export function useChat(
  sessionId: string,
  // Called with a message's text once it's undone, to edit and resend.
  onUndone?: (text: string) => void
) {
  const [items, setItemsState] = useState<ChatItem[]>([]);
  // The items as last set, for updates that read them outside a render.
  const itemsRef = useRef<ChatItem[]>([]);
  const setItems = useCallback((next: ChatItem[]) => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);
  // Older history: where it starts, whether there's more, and background
  // tasks from before the loaded items.
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [earlierTasks, setEarlierTasks] = useState<ChatItem[]>([]);
  const [toolBodies, setToolBodies] = useState<Record<string, ToolBody | null>>(
    {}
  );
  const [state, setState] = useState<ChatState>("idle");
  const [connected, setConnected] = useState(false);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModelState] = useState("");
  const [access, setAccessState] = useState<ChatAccess>("full");
  const [plan, setPlanState] = useState<boolean | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [undoPreview, setUndoPreview] = useState<{
    from: string;
    preview: UndoPreview | null; // null while it loads
  } | null>(null);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const fileRequests = useRef(
    new Map<string, (files: FileSuggestion[]) => void>()
  );
  const [taskOutputs, setTaskOutputs] = useState<Record<string, string | null>>(
    {}
  );
  const onUndoneRef = useRef(onUndone);
  useEffect(() => {
    onUndoneRef.current = onUndone;
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Another conversation: nothing of the last one carries over.
    setItems([]);
    cursor.current = null;
    setHasMore(false);
    setToolBodies({});
    // Streamed words land many to a frame: one render per frame, not per word.
    const deltas = new Map<string, string>();
    let frame: number | null = null;
    const flushDeltas = () => {
      frame = null;
      if (!deltas.size) return;
      const batch = new Map(deltas);
      deltas.clear();
      setItems(applyDeltas(itemsRef.current, batch));
    };
    // Items are applied in order with the deltas around them.
    const withDeltas = (fn: () => void) => {
      if (frame !== null) cancelAnimationFrame(frame);
      flushDeltas();
      fn();
    };

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/chat?session=${encodeURIComponent(sessionId)}&paged=1`
      );
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const m = JSON.parse(event.data) as ChatServerMessage;
        if (m.type === "snapshot") {
          withDeltas(() => {
            const kept = joinPage(itemsRef.current, m.items);
            if (!kept) {
              cursor.current = m.cursor;
              setHasMore(m.hasMore);
            }
            setItems(kept ?? m.items);
          });
          setEarlierTasks(m.tasks ?? []);
          setLoadingOlder(false);
          setState(m.state);
          setQueue(m.queue ?? []);
          setSuggestion(m.suggestion ?? null);
        } else if (m.type === "queue") {
          setQueue(m.queue);
        } else if (m.type === "suggestion") {
          setSuggestion(m.text);
        } else if (m.type === "files") {
          fileRequests.current.get(m.reqId)?.(m.files);
          fileRequests.current.delete(m.reqId);
        } else if (m.type === "state") {
          setState(m.state);
        } else if (m.type === "capabilities") {
          setCommands(m.commands);
          setModels(m.models);
          setModelState(m.model);
          setAccessState(m.access);
          setPlanState(m.plan);
        } else if (m.type === "context") {
          setContext(m.context);
        } else if (m.type === "task_output") {
          setTaskOutputs((prev) => ({ ...prev, [m.taskId]: m.text }));
        } else if (m.type === "undo_preview") {
          setUndoPreview({ from: m.from, preview: m.preview });
        } else if (m.type === "undone") {
          setUndoPreview(null);
          onUndoneRef.current?.(m.text);
        } else if (m.type === "history") {
          if (m.before !== cursor.current) return;
          cursor.current = m.cursor;
          setHasMore(m.hasMore);
          setLoadingOlder(false);
          const prev = itemsRef.current;
          const have = new Set(prev.map((p) => p.id));
          setItems(m.items.filter((i) => !have.has(i.id)).concat(prev));
        } else if (m.type === "tool_body") {
          setToolBodies((prev) => ({ ...prev, [m.id]: m.body }));
        } else if (m.type === "item") {
          withDeltas(() => {
            const prev = itemsRef.current;
            const i = lastIndexOfId(prev, m.item.id);
            const next = prev.slice();
            if (i === -1) next.push(m.item);
            else next[i] = m.item;
            setItems(next);
          });
        } else if (m.type === "delta") {
          deltas.set(m.id, (deltas.get(m.id) ?? "") + m.text);
          frame ??= requestAnimationFrame(flushDeltas);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        setLoadingOlder(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
    };

    connect();
    const onVisible = () => {
      const ws = wsRef.current;
      if (
        document.visibilityState === "visible" &&
        ws &&
        ws.readyState > WebSocket.OPEN
      ) {
        clearTimeout(retry);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      clearTimeout(retry);
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
    };
  }, [sessionId, setItems]);

  const queryClient = useQueryClient();
  const send = useCallback(
    (text: string, images?: ChatImage[]) => {
      const ws = wsRef.current;
      if (!ws) return;
      ws.send(JSON.stringify({ type: "send", text, images }));
      if (ws.readyState === WebSocket.OPEN) markRunning(queryClient, sessionId);
    },
    [queryClient, sessionId]
  );

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }, []);

  const setModel = useCallback((value: string) => {
    setModelState(value);
    wsRef.current?.send(JSON.stringify({ type: "set_model", model: value }));
  }, []);

  const setAccess = useCallback((value: ChatAccess) => {
    setAccessState(value);
    wsRef.current?.send(JSON.stringify({ type: "set_access", access: value }));
  }, []);

  const setPlan = useCallback((value: boolean) => {
    setPlanState(value);
    wsRef.current?.send(JSON.stringify({ type: "set_plan", plan: value }));
  }, []);

  // Leaves plan mode and starts the plan.
  const carryPlan = useCallback(
    (id: string) => {
      setPlanState((p) => (p === null ? p : false));
      wsRef.current?.send(JSON.stringify({ type: "carry_plan", id }));
      markRunning(queryClient, sessionId);
    },
    [queryClient, sessionId]
  );

  const respond = useCallback((id: string, answer: ApprovalDecision) => {
    wsRef.current?.send(JSON.stringify({ type: "respond", id, ...answer }));
  }, []);

  // A dry run first, so the reader sees what an undo would change.
  const undo = useCallback((from: string, dryRun: boolean) => {
    setUndoPreview({ from, preview: null });
    wsRef.current?.send(JSON.stringify({ type: "undo", from, dryRun }));
  }, []);

  const stopTask = useCallback((taskId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "stop_task", taskId }));
  }, []);

  const queueEdit = useCallback((id: string, text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "queue_edit", id, text }));
  }, []);
  const queueMove = useCallback((id: string, by: -1 | 1) => {
    wsRef.current?.send(JSON.stringify({ type: "queue_move", id, by }));
  }, []);
  const queueDelete = useCallback((id: string) => {
    wsRef.current?.send(JSON.stringify({ type: "queue_delete", id }));
  }, []);
  // Stops the turn the reader sees running (its opening message), and only
  // that one: a turn that started since isn't theirs to stop.
  const queueSendNow = useCallback((id: string, during?: string) => {
    wsRef.current?.send(JSON.stringify({ type: "queue_send_now", id, during }));
  }, []);

  // The files and folders an @mention could mean; empty when the socket is
  // down or no answer comes.
  const requestFiles = useCallback((query: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.resolve<FileSuggestion[]>([]);
    const reqId = Math.random().toString(36).slice(2);
    return new Promise<FileSuggestion[]>((resolve) => {
      const timer = setTimeout(() => {
        fileRequests.current.delete(reqId);
        resolve([]);
      }, 8000);
      fileRequests.current.set(reqId, (files) => {
        clearTimeout(timer);
        resolve(files);
      });
      ws.send(JSON.stringify({ type: "files", reqId, query }));
    });
  }, []);

  const loadTaskOutput = useCallback((taskId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "task_output", taskId }));
  }, []);

  // The page before the oldest loaded item, once at a time.
  const loadOlder = useCallback(() => {
    const ws = wsRef.current;
    if (loadingOlder || !hasMore || cursor.current === null) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setLoadingOlder(true);
    ws.send(JSON.stringify({ type: "history", before: cursor.current }));
  }, [loadingOlder, hasMore]);

  const requestToolBody = useCallback((id: string) => {
    wsRef.current?.send(JSON.stringify({ type: "tool_body", id }));
  }, []);

  return {
    items,
    hasMore,
    loadingOlder,
    loadOlder,
    earlierTasks,
    toolBodies,
    requestToolBody,
    state,
    connected,
    commands,
    models,
    model,
    send,
    interrupt,
    setModel,
    access,
    setAccess,
    plan,
    setPlan,
    carryPlan,
    context,
    respond,
    undo,
    undoPreview,
    clearUndo: () => setUndoPreview(null),
    stopTask,
    loadTaskOutput,
    taskOutputs,
    queue,
    queueEdit,
    queueMove,
    queueDelete,
    queueSendNow,
    suggestion,
    requestFiles,
  };
}
