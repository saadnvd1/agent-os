/**
 * One /ws/chat socket: a snapshot of the session's chat, then live items;
 * takes messages, queue edits, settings and interrupts.
 *
 * The session can be deleted while its socket is open. Every message checks
 * it still exists, and a failure anywhere (thrown or rejected) is caught here:
 * nothing a client sends can take the server down.
 */

import { db } from "../db";
import {
  carryOutPlan,
  chatFileSuggestions,
  chatHistory,
  chatTaskOutput,
  chatToolBody,
  deleteQueuedChat,
  editQueuedChat,
  interruptChat,
  moveQueuedChat,
  respondChat,
  sendChat,
  sendQueuedNow,
  setChatAccess,
  setChatModel,
  setChatPlan,
  stopChatTask,
  undoChat,
  watchChat,
} from "./runner";
import { clientSend } from "./client-send";
import { DEMO_CHAT_READS, handleDemoChat } from "./demo";
import { titleChatFromMessage } from "../session-titles";
import type {
  ChatClientMessage,
  ChatServerMessage,
  FileSuggestion,
} from "./events";

export interface ChatSocket {
  on(event: "message", fn: (raw: Buffer) => void): unknown;
  on(event: "close" | "error", fn: () => void): unknown;
  close(code?: number, reason?: string): void;
}

// Closed because the session it watched no longer exists.
export const SESSION_GONE = 4404;

const sessionExists = (id: string) =>
  !!db.prepare(`SELECT 1 FROM sessions WHERE id = ?`).get(id);

const errorItem = (message: string): ChatServerMessage => ({
  type: "item",
  item: {
    id: `error-${Date.now()}`,
    kind: "error",
    message,
    createdAt: Date.now(),
  },
});

export function serveChatSocket(
  ws: ChatSocket,
  params: URLSearchParams,
  send: (json: string) => unknown,
  demo = false
): void {
  let closed = false;
  let unwatch = () => {};
  const stop = () => {
    closed = true;
    unwatch();
  };
  // First, so every way out below leaves a listener: an "error" from a
  // closing socket with none would be thrown.
  ws.on("close", stop);
  ws.on("error", stop);

  const sessionId = params.get("session");
  if (!sessionId) return ws.close();
  const reply = (m: ChatServerMessage) => void send(JSON.stringify(m));
  const gone = () => {
    if (closed) return;
    stop();
    reply(errorItem("This session no longer exists"));
    ws.close(SESSION_GONE, "session not found");
  };
  // A failure from any message: the socket is closed when the session went
  // away under it, and the client is told what failed otherwise.
  const fail = (err: unknown) => {
    console.error(`[chat ${sessionId}] message failed:`, err);
    if (!sessionExists(sessionId)) return gone();
    reply(errorItem(err instanceof Error ? err.message : String(err)));
  };

  if (!sessionExists(sessionId)) return gone();
  try {
    unwatch = watchChat(sessionId, reply, params.get("paged") === "1");
  } catch (err) {
    fail(err);
    if (!closed) ws.close();
    return;
  }

  ws.on("message", (raw: Buffer) => {
    if (closed) return;
    try {
      if (!sessionExists(sessionId)) return gone();
      const msg = JSON.parse(raw.toString()) as ChatClientMessage;
      // A demo answers reads as usual and nothing that changes anything.
      if (demo && !DEMO_CHAT_READS.has(msg.type))
        handleDemoChat(sessionId, msg, reply);
      else onChatMessage(sessionId, msg, reply, fail);
    } catch (err) {
      fail(err);
    }
  });
}

function onChatMessage(
  sessionId: string,
  msg: ChatClientMessage,
  reply: (m: ChatServerMessage) => void,
  fail: (err: unknown) => void
): void {
  // Every promise ends here, so none is left to reject unhandled.
  const run = (p: Promise<unknown> | unknown) =>
    void Promise.resolve(p).catch(fail);
  if (msg.type === "send") {
    const send = clientSend(msg);
    run(sendChat(sessionId, { ...send, queue: true }));
    // "Session 4" is named after its first message.
    run(titleChatFromMessage(sessionId, send.text));
  } else if (msg.type === "queue_edit" && typeof msg.text === "string")
    editQueuedChat(sessionId, String(msg.id), msg.text);
  else if (msg.type === "queue_move")
    moveQueuedChat(sessionId, String(msg.id), msg.by === -1 ? -1 : 1);
  else if (msg.type === "queue_delete")
    deleteQueuedChat(sessionId, String(msg.id));
  else if (msg.type === "queue_send_now")
    run(
      sendQueuedNow(
        sessionId,
        String(msg.id),
        typeof msg.during === "string" ? msg.during : undefined
      )
    );
  else if (msg.type === "files" && typeof msg.query === "string") {
    const answer = (files: FileSuggestion[]) =>
      reply({
        type: "files",
        reqId: String(msg.reqId),
        query: msg.query,
        files,
      });
    run(
      chatFileSuggestions(sessionId, msg.query.slice(0, 200))
        .catch(() => [])
        .then(answer)
    );
  } else if (msg.type === "interrupt") run(interruptChat(sessionId));
  else if (msg.type === "set_model") run(setChatModel(sessionId, msg.model));
  else if (msg.type === "set_access") run(setChatAccess(sessionId, msg.access));
  else if (msg.type === "set_plan") run(setChatPlan(sessionId, !!msg.plan));
  else if (msg.type === "carry_plan")
    run(carryOutPlan(sessionId, String(msg.id)));
  else if (msg.type === "respond") respondChat(sessionId, msg.id, msg);
  else if (msg.type === "stop_task") stopChatTask(sessionId, msg.taskId);
  else if (msg.type === "task_output")
    reply({
      type: "task_output",
      taskId: msg.taskId,
      text: chatTaskOutput(sessionId, msg.taskId),
    });
  else if (msg.type === "history" && Number.isFinite(msg.before))
    reply({
      type: "history",
      before: msg.before,
      ...chatHistory(sessionId, msg.before),
    });
  else if (msg.type === "tool_body")
    reply({
      type: "tool_body",
      id: String(msg.id),
      body: chatToolBody(sessionId, String(msg.id)),
    });
  else if (msg.type === "undo")
    run(
      undoChat(sessionId, msg.from, !!msg.dryRun, reply).catch((err) =>
        reply({
          type: "undo_preview",
          from: msg.from,
          preview: {
            canUndo: false,
            files: [],
            error: err instanceof Error ? err.message : String(err),
          },
        })
      )
    );
}
