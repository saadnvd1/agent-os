import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  ApprovalDecision,
  ChatAccess,
  ChatClientMessage,
  ChatImage,
  ChatServerMessage,
  FileSuggestion,
} from "@/lib/chat/events";
import { authHeaders } from "~/lib/api/client";
import type { Machine } from "~/lib/machines/store";
import { socketUrl } from "~/lib/machines/url";
import { openSocket, type SocketState } from "~/lib/ws/socket";
import { failover } from "~/lib/machines/reach";
import { applyChatMessage, EMPTY_CHAT, runningTurn } from "./reducer";

export function useChat(machine: Machine | null, sessionId: string) {
  const [view, dispatch] = useReducer(applyChatMessage, EMPTY_CHAT);
  const [link, setLink] = useState<SocketState>("connecting");
  const files = useRef(new Map<string, (f: FileSuggestion[]) => void>());
  const socket = useRef<ReturnType<
    typeof openSocket<ChatServerMessage, ChatClientMessage>
  > | null>(null);

  useEffect(() => {
    if (!machine) return;
    const s = openSocket<ChatServerMessage, ChatClientMessage>({
      url: socketUrl(
        machine.url,
        `/ws/chat?session=${encodeURIComponent(sessionId)}`
      ),
      headers: authHeaders(machine),
      onState: setLink,
      onStuck: () => void failover(machine.id),
      onMessage: (msg) => {
        if (msg.type !== "files") return dispatch(msg);
        files.current.get(msg.reqId)?.(msg.files);
        files.current.delete(msg.reqId);
      },
    });
    socket.current = s;
    return () => {
      socket.current = null;
      s.close();
    };
  }, [machine, sessionId]);

  const actions = useMemo(() => {
    const send = (msg: ChatClientMessage) => socket.current?.send(msg) ?? false;
    return {
      send: (text: string, images?: ChatImage[]) =>
        send({ type: "send", text, ...(images?.length ? { images } : {}) }),
      interrupt: () => send({ type: "interrupt" }),
      deleteQueued: (id: string) => send({ type: "queue_delete", id }),
      respond: (id: string, decision: ApprovalDecision) =>
        send({ type: "respond", id, ...decision }),
      reconnect: () => socket.current?.reconnect(),
      // @file search: answered on the socket, [] when it doesn't come back.
      findFiles: (query: string) =>
        new Promise<FileSuggestion[]>((resolve) => {
          const reqId = Math.random().toString(36).slice(2);
          const timer = setTimeout(() => {
            files.current.delete(reqId);
            resolve([]);
          }, 8000);
          files.current.set(reqId, (f) => {
            clearTimeout(timer);
            resolve(f);
          });
          if (!send({ type: "files", reqId, query })) {
            clearTimeout(timer);
            files.current.delete(reqId);
            resolve([]);
          }
        }),
    };
  }, []);

  // Pills update at once; the server confirms with fresh capabilities.
  const caps = view.caps;
  const setting = <K extends "model" | "access" | "plan">(
    key: K,
    value: NonNullable<typeof caps>[K]
  ) => {
    if (!caps) return;
    const msg =
      key === "model"
        ? { type: "set_model" as const, model: value as string }
        : key === "access"
          ? { type: "set_access" as const, access: value as ChatAccess }
          : { type: "set_plan" as const, plan: value as boolean };
    if (socket.current?.send(msg))
      dispatch({ type: "capabilities", ...caps, [key]: value });
  };

  const during = runningTurn(view);
  const sendNow = (id: string) =>
    socket.current?.send({
      type: "queue_send_now",
      id,
      ...(during ? { during } : {}),
    }) ?? false;

  return {
    view,
    live: link === "open",
    ...actions,
    sendNow,
    setModel: (model: string) => setting("model", model),
    setAccess: (access: ChatAccess) => setting("access", access),
    setPlan: (plan: boolean) => setting("plan", plan),
  };
}
