"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatCommand,
  ChatImage,
  ChatItem,
  ChatModel,
  ChatServerMessage,
  ChatState,
  UndoPreview,
} from "@/lib/chat/events";

// One chat conversation over its WebSocket: a snapshot, then live items and
// streamed text. Reconnects when the socket drops (e.g. a phone waking up).
export function useChat(
  sessionId: string,
  // Called with a message's text once it's undone, to edit and resend.
  onUndone?: (text: string) => void
) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<ChatState>("idle");
  const [connected, setConnected] = useState(false);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModelState] = useState("");
  const [access, setAccessState] = useState<ChatAccess>("full");
  const [undoPreview, setUndoPreview] = useState<{
    from: string;
    preview: UndoPreview | null; // null while it loads
  } | null>(null);
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

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/chat?session=${encodeURIComponent(sessionId)}`
      );
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const m = JSON.parse(event.data) as ChatServerMessage;
        if (m.type === "snapshot") {
          setItems(m.items);
          setState(m.state);
        } else if (m.type === "state") {
          setState(m.state);
        } else if (m.type === "capabilities") {
          setCommands(m.commands);
          setModels(m.models);
          setModelState(m.model);
          setAccessState(m.access);
        } else if (m.type === "task_output") {
          setTaskOutputs((prev) => ({ ...prev, [m.taskId]: m.text }));
        } else if (m.type === "undo_preview") {
          setUndoPreview({ from: m.from, preview: m.preview });
        } else if (m.type === "undone") {
          setUndoPreview(null);
          onUndoneRef.current?.(m.text);
        } else if (m.type === "item") {
          setItems((prev) => {
            const i = prev.findIndex((p) => p.id === m.item.id);
            if (i === -1) return [...prev, m.item];
            const next = prev.slice();
            next[i] = m.item;
            return next;
          });
        } else if (m.type === "delta") {
          setItems((prev) =>
            prev.map((p) =>
              p.id === m.id && "text" in p ? { ...p, text: p.text + m.text } : p
            )
          );
        }
      };
      ws.onclose = () => {
        setConnected(false);
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
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
    };
  }, [sessionId]);

  const send = useCallback((text: string, images?: ChatImage[]) => {
    wsRef.current?.send(JSON.stringify({ type: "send", text, images }));
  }, []);

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

  const loadTaskOutput = useCallback((taskId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "task_output", taskId }));
  }, []);

  return {
    items,
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
    respond,
    undo,
    undoPreview,
    clearUndo: () => setUndoPreview(null),
    stopTask,
    loadTaskOutput,
    taskOutputs,
  };
}
