import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  ApprovalDecision,
  ChatClientMessage,
  ChatImage,
  ChatServerMessage,
} from "@/lib/chat/events";
import { authHeaders } from "~/lib/api/client";
import type { Machine } from "~/lib/machines/store";
import { socketUrl } from "~/lib/machines/url";
import { openSocket, type SocketState } from "~/lib/ws/socket";
import { applyChatMessage, EMPTY_CHAT, runningTurn } from "./reducer";

export function useChat(machine: Machine | null, sessionId: string) {
  const [view, dispatch] = useReducer(applyChatMessage, EMPTY_CHAT);
  const [link, setLink] = useState<SocketState>("connecting");
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
      onMessage: dispatch,
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
    };
  }, []);

  const during = runningTurn(view);
  const sendNow = (id: string) =>
    socket.current?.send({
      type: "queue_send_now",
      id,
      ...(during ? { during } : {}),
    }) ?? false;

  return { view, live: link === "open", ...actions, sendNow };
}
