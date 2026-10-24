/**
 * Chat in demo mode: the stub driver (drivers/demo) runs in this process,
 * with no worker and no agent, and its items are stored and streamed to
 * watchers exactly as a worker's would be.
 */

import { randomUUID } from "crypto";
import { clientSend } from "./client-send";
import type { ChatConversation } from "./driver";
import type {
  ChatClientMessage,
  ChatServerMessage,
  ChatState,
  ModelWait,
} from "./events";
import { demoConversation } from "./drivers/demo";
import { DEMO_SCRIPT_PROMPT, parseDemoScript } from "./drivers/demo-script";
import { ModelWaitTracker } from "./model-wait";
import type { WorkerEvent } from "./worker/protocol";
import { emit, getSession } from "./registry";
import { deleteItems, saveItem } from "./store";
import { DEMO_REFUSAL, DEMO_VISITOR_TEXT } from "../security/demo";

const conversations = new Map<string, ChatConversation>();
// How long each streamed word takes; tests make it 0.
let stepMs = 40;
export const setDemoReplyStep = (ms: number) => (stepMs = ms);
// Strangers can type here: a cap keeps them from growing the database.
export const MAX_SENDS = 50;
const sends = new Map<string, number>();

// What a demo chat is doing, for a watcher that connects mid-turn (the stored
// items alone would show a running step as stopped).
const live = new Map<string, { state: ChatState; wait: ModelWait | null }>();

/** The demo chat's running turn, or null with none. */
export function demoLive(sessionId: string) {
  return live.get(sessionId) ?? null;
}

function conversation(sessionId: string): ChatConversation {
  let c = conversations.get(sessionId);
  if (c) return c;
  c = demoConversation(stepMs);
  conversations.set(sessionId, c);
  let tracker = new ModelWaitTracker();
  void (async () => {
    for await (const e of c.events) {
      // Each turn follows its own waits, whatever the last one left.
      if (e.type === "state" && e.state === "running")
        tracker = new ModelWaitTracker();
      if (tracker.on(e as WorkerEvent))
        emit(sessionId, { type: "model_wait", wait: tracker.wait });
      if (e.type === "state") {
        if (e.state === "idle") live.delete(sessionId);
        else live.set(sessionId, { state: e.state, wait: tracker.wait });
      }
      const state = live.get(sessionId);
      if (state) state.wait = tracker.wait;
      if (e.type === "item") {
        if (!("streaming" in e.item && e.item.streaming))
          saveItem(sessionId, e.item);
        emit(sessionId, { type: "item", item: e.item });
      } else if (e.type === "delta" || e.type === "state") emit(sessionId, e);
    }
  })();
  return c;
}

export function sendDemoChat(
  sessionId: string,
  text: string,
  id = `user-${Date.now()}-${randomUUID().slice(0, 5)}`
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  getSession(sessionId);
  const count = sends.get(sessionId) ?? 0;
  if (count >= MAX_SENDS) throw new Error(DEMO_REFUSAL);
  sends.set(sessionId, count + 1);
  // The scripted turn (drivers/demo-script) is canned text a visitor can only
  // trigger, never change, so its prompt is shown as is.
  const script = parseDemoScript(trimmed) !== null;
  // A scripted turn starts a clean chat, so screenshots never show the last.
  if (script) {
    deleteItems(sessionId);
    live.delete(sessionId);
  }
  const item = {
    id,
    kind: "user" as const,
    text: script ? DEMO_SCRIPT_PROMPT : DEMO_VISITOR_TEXT,
    tagged: true as const,
    createdAt: Date.now(),
  };
  saveItem(sessionId, item);
  emit(sessionId, { type: "item", item });
  conversation(sessionId).send(script ? trimmed : DEMO_VISITOR_TEXT);
}

/** After a re-seed: stub conversations and send counts start over. */
export function resetDemoChat(): void {
  for (const [sessionId, c] of conversations) {
    c.close();
    // A reply cut off mid-stream: watchers stop showing it as running.
    emit(sessionId, { type: "state", state: "idle" });
  }
  conversations.clear();
  live.clear();
  sends.clear();
}

// Messages that only read what's stored; the socket answers them as usual.
export const DEMO_CHAT_READS = new Set<ChatClientMessage["type"]>([
  "history",
  "tool_body",
  "task_output",
  "search",
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
  if (msg.type === "send") {
    const { id } = clientSend(msg);
    if (!id) return sendDemoChat(sessionId, String(msg.text));
    reply({ type: "accepted", id });
    try {
      return sendDemoChat(sessionId, String(msg.text), id);
    } catch (err) {
      reply({
        type: "send_failed",
        id,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
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
