"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { markRunning } from "../statuses/stream";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatCommand,
  ChatContext,
  ChatFile,
  ChatImage,
  ChatItem,
  ChatModel,
  ChatServerMessage,
  ChatState,
  Compacting,
  ModelWait,
  FileSuggestion,
  QueuedMessage,
  ToolBody,
  UndoPreview,
} from "@/lib/chat/events";
import type { SearchResult } from "@/lib/chat/find";
import { addBody, touchBody } from "@/lib/chat/bodyCache";
import { backgroundFailure, type TaskOutput } from "@/lib/chat/background";
import {
  NOT_SENT,
  clientId,
  overSends,
  toResend,
  type PendingSend,
} from "@/lib/chat/pending";
import { usePending } from "./usePending";

// A pending send as the socket's `send`, under its own id.
const sendFrame = (
  p: Pick<PendingSend, "id" | "text" | "images" | "files" | "compact">
) =>
  JSON.stringify({
    type: "send",
    text: p.text,
    images: p.images,
    files: p.files,
    clientId: p.id,
    ...(p.compact && { compact: true }),
  });

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

// Where a live item lands: replaced in place when loaded, in the composer's
// list when it's a background task from before the loaded page, else at the
// end. Unchanged lists keep their identity.
export function routeItem(
  items: ChatItem[],
  earlier: ChatItem[],
  item: ChatItem
): { items: ChatItem[]; earlier: ChatItem[] } {
  const i = lastIndexOfId(items, item.id);
  if (i === -1 && earlier.some((t) => t.id === item.id))
    return {
      items,
      earlier: earlier.map((t) => (t.id === item.id ? item : t)),
    };
  const next = items.slice();
  if (i === -1) next.push(item);
  else next[i] = item;
  return { items: next, earlier };
}

// Tool bodies still good after a reconnect's snapshot: a finished tool's
// output can't change, but one running then, or whose status moved while
// away, is asked for again.
export function keptBodies(
  bodies: Record<string, ToolBody | null>,
  before: ChatItem[],
  page: ChatItem[]
): Record<string, ToolBody | null> {
  const was = new Map(
    before.flatMap((i) => (i.kind === "tool" ? [[i.id, i.status]] : []))
  );
  const stale = new Set(
    page
      .filter(
        (i) =>
          i.kind === "tool" &&
          (i.status === "running" || was.get(i.id) !== i.status)
      )
      .map((i) => i.id)
  );
  const next: Record<string, ToolBody | null> = {};
  for (const [id, body] of Object.entries(bodies))
    if (body !== null && !stale.has(id)) next[id] = body;
  return next;
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
  const [earlierTasks, setEarlierTasksState] = useState<ChatItem[]>([]);
  const earlierTasksRef = useRef<ChatItem[]>([]);
  const setEarlierTasks = useCallback((next: ChatItem[]) => {
    earlierTasksRef.current = next;
    setEarlierTasksState(next);
  }, []);
  const [toolBodies, setToolBodies] = useState<Record<string, ToolBody | null>>(
    {}
  );
  // Bodies open on screen, never evicted from toolBodies.
  const visibleBodies = useRef(new Set<string>());
  const pinToolBody = useCallback((id: string) => {
    visibleBodies.current.add(id);
    setToolBodies((prev) => touchBody(prev, id));
    return () => void visibleBodies.current.delete(id);
  }, []);
  const [state, setState] = useState<ChatState>("idle");
  const [compacting, setCompacting] = useState<Compacting | null>(null);
  const [modelWait, setModelWait] = useState<ModelWait | null>(null);
  const [connected, setConnected] = useState(false);
  // The chat whose snapshot the items are, once one has landed.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModelState] = useState("");
  const [modelLabel, setModelLabel] = useState<string | undefined>();
  const [refreshingCommands, setRefreshingCommands] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
  const searchRequests = useRef(
    new Map<string, (result: SearchResult) => void>()
  );
  const [taskOutputs, setTaskOutputs] = useState<Record<string, TaskOutput>>(
    {}
  );
  const [canBackground, setCanBackground] = useState(false);
  // The calls asked to move to the background and not yet answered
  // ("all" for the shortcut).
  const [movingToBackground, setMovingToBackground] = useState<
    ReadonlySet<string>
  >(new Set());
  const onUndoneRef = useRef(onUndone);
  useEffect(() => {
    onUndoneRef.current = onUndone;
  });
  const wsRef = useRef<WebSocket | null>(null);
  const {
    pending,
    pendingRef,
    dispatch: pend,
    restore: restorePending,
  } = usePending(sessionId, connected);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Another conversation: nothing of the last one carries over.
    setItems([]);
    cursor.current = null;
    setHasMore(false);
    setToolBodies({});
    setEarlierTasks([]);
    setLoadingOlder(false);
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
      ws.onopen = () => {
        setConnected(true);
        restorePending();
        // Sends the last socket took and may have lost: the server drops
        // any it already has.
        for (const p of overSends(pendingRef.current))
          pend({ type: "failed", id: p.id, error: NOT_SENT });
        for (const p of toResend(pendingRef.current)) {
          ws.send(sendFrame(p));
          pend({ type: "resent", id: p.id, now: Date.now() });
        }
      };
      ws.onmessage = (event) => {
        const m = JSON.parse(event.data) as ChatServerMessage;
        if (m.type === "snapshot") {
          const before = itemsRef.current;
          withDeltas(() => {
            const kept = joinPage(itemsRef.current, m.items);
            if (!kept) {
              cursor.current = m.cursor;
              setHasMore(m.hasMore);
            }
            setItems(kept ?? m.items);
          });
          setEarlierTasks(m.tasks ?? []);
          setToolBodies((prev) => keptBodies(prev, before, m.items));
          setLoadingOlder(false);
          setState(m.state);
          setCompacting(m.compacting ?? null);
          setModelWait(m.modelWait ?? null);
          setQueue(m.queue ?? []);
          setSuggestion(m.suggestion ?? null);
          setLoadedFor(sessionId);
          pend({
            type: "resolved",
            ids: [...m.items, ...(m.queue ?? [])].map((i) => i.id),
          });
        } else if (m.type === "queue") {
          setQueue(m.queue);
          pend({ type: "resolved", ids: m.queue.map((q) => q.id) });
        } else if (m.type === "accepted") {
          pend({ type: "accepted", id: m.id, now: Date.now() });
        } else if (m.type === "send_failed") {
          pend({ type: "failed", id: m.id, error: m.message });
        } else if (m.type === "suggestion") {
          setSuggestion(m.text);
        } else if (m.type === "files") {
          fileRequests.current.get(m.reqId)?.(m.files);
          fileRequests.current.delete(m.reqId);
        } else if (m.type === "search") {
          searchRequests.current.get(m.reqId)?.(m);
          searchRequests.current.delete(m.reqId);
        } else if (m.type === "compacting") {
          setCompacting(m.compacting);
        } else if (m.type === "model_wait") {
          setModelWait(m.wait);
        } else if (m.type === "state") {
          setState(m.state);
          if (m.state === "idle" || m.state === "error") {
            setCompacting(null);
            setModelWait(null);
          }
        } else if (m.type === "capabilities") {
          setRefreshingCommands(false);
          setCommands(m.commands);
          setModels(m.models);
          setModelState(m.model);
          setModelLabel(m.modelLabel);
          setAccessState(m.access);
          setPlanState(m.plan);
          setCanBackground(!!m.background);
        } else if (m.type === "context") {
          setContext(m.context);
        } else if (m.type === "background_result") {
          const key = m.toolUseId ?? "all";
          setMovingToBackground((prev) => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          const all = itemsRef.current;
          const tool = all.find((i) => i.id === m.toolUseId);
          const task = all.find(
            (i) => i.kind === "task" && i.toolUseId === m.toolUseId
          );
          const message = backgroundFailure(
            m,
            tool?.kind === "tool" ? tool : undefined,
            task?.kind === "task" ? task : undefined
          );
          if (message) toast(message, { duration: 2500 });
        } else if (m.type === "task_output") {
          setTaskOutputs((prev) => ({
            ...prev,
            [m.taskId]: { text: m.text, updatedAt: m.updatedAt },
          }));
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
          setToolBodies((prev) =>
            addBody(prev, m.id, m.body, visibleBodies.current)
          );
        } else if (m.type === "item") {
          if (m.item.kind === "user")
            pend({ type: "resolved", ids: [m.item.id] });
          withDeltas(() => {
            const routed = routeItem(
              itemsRef.current,
              earlierTasksRef.current,
              m.item
            );
            if (routed.items !== itemsRef.current) setItems(routed.items);
            if (routed.earlier !== earlierTasksRef.current)
              setEarlierTasks(routed.earlier);
          });
        } else if (m.type === "delta") {
          deltas.set(m.id, (deltas.get(m.id) ?? "") + m.text);
          frame ??= requestAnimationFrame(flushDeltas);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        setRefreshingCommands(false);
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
  }, [sessionId, setItems, setEarlierTasks, pend, pendingRef, restorePending]);

  const queryClient = useQueryClient();
  const send = useCallback(
    // `compact`: the reader let a stale chat compact first (lib/chat/stale).
    // It shows as a pending bubble at once, until it's in the chat.
    (
      text: string,
      images?: ChatImage[],
      compact?: boolean,
      files?: ChatFile[]
    ) => {
      const p = { id: clientId(), text, images, files, compact };
      pend({ type: "add", send: p, now: Date.now() });
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) {
        pend({ type: "failed", id: p.id, error: NOT_SENT });
        return;
      }
      ws.send(sendFrame(p));
      markRunning(queryClient, sessionId);
    },
    [queryClient, sessionId, pend]
  );

  const retrySend = useCallback(
    (id: string) => {
      const p = pendingRef.current.find((s) => s.id === id);
      const ws = wsRef.current;
      if (!p) return;
      if (ws?.readyState !== WebSocket.OPEN) {
        pend({ type: "failed", id, error: NOT_SENT });
        return;
      }
      ws.send(sendFrame(p));
      pend({ type: "resent", id, now: Date.now() });
    },
    [pend, pendingRef]
  );

  const dropSend = useCallback(
    (id: string) => pend({ type: "drop", id }),
    [pend]
  );

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }, []);

  const setModel = useCallback((value: string) => {
    setModelState(value);
    wsRef.current?.send(JSON.stringify({ type: "set_model", model: value }));
  }, []);

  // Loads the "/" commands again, past the server's cache.
  const refreshCommands = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    setRefreshingCommands(true);
    ws.send(JSON.stringify({ type: "refresh_commands" }));
    // A failed load answers with an error, not a list: don't spin forever.
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(
      () => setRefreshingCommands(false),
      35_000
    );
  }, []);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

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

  // One call (or, with none given, every call that blocks the turn) goes to
  // the background; the answer comes back as a toast only if it failed.
  const backgroundTask = useCallback((toolUseId?: string) => {
    const key = toolUseId ?? "all";
    if (!wsRef.current) return;
    setMovingToBackground((prev) => new Set(prev).add(key));
    wsRef.current.send(JSON.stringify({ type: "background_task", toolUseId }));
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

  // A page of find's results from the stored conversation, newest first;
  // null when the socket is down or no answer comes (a linked machine's
  // AgentOS too old to search).
  const search = useCallback((query: string, before?: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.resolve<SearchResult | null>(null);
    const reqId = Math.random().toString(36).slice(2);
    return new Promise<SearchResult | null>((resolve) => {
      const timer = setTimeout(() => {
        searchRequests.current.delete(reqId);
        resolve(null);
      }, 10_000);
      searchRequests.current.set(reqId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      ws.send(JSON.stringify({ type: "search", reqId, query, before }));
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

  // Asked again by the opened tool once the socket is back (useToolBody).
  const requestToolBody = useCallback((id: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "tool_body", id }));
  }, []);

  return {
    items,
    loadedFor,
    hasMore,
    loadingOlder,
    loadOlder,
    earlierTasks,
    toolBodies,
    requestToolBody,
    pinToolBody,
    state,
    compacting,
    modelWait,
    connected,
    commands,
    refreshCommands,
    refreshingCommands,
    models,
    model,
    modelLabel,
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
    canBackground,
    backgroundTask,
    movingToBackground,
    loadTaskOutput,
    taskOutputs,
    queue,
    pending,
    retrySend,
    dropSend,
    queueEdit,
    queueMove,
    queueDelete,
    queueSendNow,
    suggestion,
    requestFiles,
    search,
  };
}
