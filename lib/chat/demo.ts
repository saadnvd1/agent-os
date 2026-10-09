/**
 * Chat in demo mode: the stub driver (drivers/demo) runs in this process,
 * with no worker and no agent, and its items are stored and streamed to
 * watchers exactly as a worker's would be.
 */

import { randomUUID } from "crypto";
import type { ChatConversation } from "./driver";
import type { ChatClientMessage, ChatServerMessage } from "./events";
import { demoConversation } from "./drivers/demo";
import { emit, getSession } from "./registry";
import { saveItem } from "./store";
import { DEMO_REFUSAL } from "../security/demo";

const conversations = new Map<string, ChatConversation>();
// How long each streamed word takes; tests make it 0.
let stepMs = 40;
export const setDemoReplyStep = (ms: number) => (stepMs = ms);
// Strangers can type here: a cap keeps them from growing the database.
export const MAX_SENDS = 50;
const sends = new Map<string, number>();

function conversation(sessionId: string): ChatConversation {
  let c = conversations.get(sessionId);
  if (c) return c;
  c = demoConversation(stepMs);
  conversations.set(sessionId, c);
  void (async () => {
    for await (const e of c.events) {
      if (e.type === "item") {
        if (!("streaming" in e.item && e.item.streaming))
          saveItem(sessionId, e.item);
        emit(sessionId, { type: "item", item: e.item });
      } else if (e.type === "delta" || e.type === "state") emit(sessionId, e);
    }
  })();
  return c;
}

export function sendDemoChat(sessionId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  getSession(sessionId);
  const count = sends.get(sessionId) ?? 0;
  if (count >= MAX_SENDS) throw new Error(DEMO_REFUSAL);
  sends.set(sessionId, count + 1);
  const item = {
    id: `user-${Date.now()}-${randomUUID().slice(0, 5)}`,
    kind: "user" as const,
    text: trimmed.slice(0, 4000),
    createdAt: Date.now(),
  };
  saveItem(sessionId, item);
  emit(sessionId, { type: "item", item });
  conversation(sessionId).send(trimmed);
}

// Messages that only read what's stored; the socket answers them as usual.
export const DEMO_CHAT_READS = new Set<ChatClientMessage["type"]>([
  "history",
  "tool_body",
  "task_output",
]);

/**
 * A chat socket's message in demo mode, other than the reads above. Sends
 * get the canned reply and interrupts stop it; everything else is refused.
 */
export function handleDemoChat(
  sessionId: string,
  msg: ChatClientMessage,
  reply: (m: ChatServerMessage) => void
): void {
  if (msg.type === "send") return sendDemoChat(sessionId, String(msg.text));
  if (msg.type === "interrupt") {
    void conversations.get(sessionId)?.interrupt();
    return;
  }
  if (msg.type === "files")
    return reply({
      type: "files",
      reqId: String(msg.reqId),
      query: msg.query,
      files: [],
    });
  reply({
    type: "item",
    item: {
      id: `error-${Date.now()}`,
      kind: "error",
      message: DEMO_REFUSAL,
      createdAt: Date.now(),
    },
  });
}
