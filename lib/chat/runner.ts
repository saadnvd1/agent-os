/**
 * Live chat conversations, one per session, for any driver. Keeps items in
 * SQLite, streams them to whoever is watching, and closes idle conversations
 * (the next message resumes them by the agent's own session id).
 */

import os from "os";
import { db, type Session } from "../db";
import { agentEnv } from "../agents/launch";
import { BUS_BRIEF } from "../agents/brief";
import { resolveModelForAgent } from "../model-catalog";
import { chatDriverFor } from "./drivers";
import type { ChatConversation } from "./driver";
import type {
  ChatImage,
  ChatItem,
  ChatServerMessage,
  ChatState,
} from "./events";
import { listItems, saveItem, settle } from "./store";

const IDLE_CLOSE_MS = 30 * 60 * 1000;

interface Live {
  conversation: ChatConversation;
  state: ChatState;
  streaming: Map<string, ChatItem>;
  idleTimer?: NodeJS.Timeout;
}

type Listener = (m: ChatServerMessage) => void;

// Shared across every module instance in the process (custom server and the
// Next.js route bundles each load their own copy of this file).
interface Registry {
  live: Map<string, Live>;
  listeners: Map<string, Set<Listener>>;
}
const g = globalThis as unknown as { __agentosChat?: Registry };
const registry: Registry = (g.__agentosChat ??= {
  live: new Map(),
  listeners: new Map(),
});

function emit(sessionId: string, m: ChatServerMessage): void {
  registry.listeners.get(sessionId)?.forEach((fn) => fn(m));
}

function getSession(sessionId: string): Session {
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
  if (!s) throw new Error("Session not found");
  return s;
}

function setState(sessionId: string, live: Live, state: ChatState): void {
  live.state = state;
  emit(sessionId, { type: "state", state });
  clearTimeout(live.idleTimer);
  if (state === "idle") {
    live.idleTimer = setTimeout(() => stopChat(sessionId), IDLE_CLOSE_MS);
  }
}

function record(sessionId: string, item: ChatItem): void {
  saveItem(sessionId, item);
  emit(sessionId, { type: "item", item });
}

async function pump(sessionId: string, live: Live): Promise<void> {
  try {
    for await (const e of live.conversation.events) {
      if (e.type === "item") {
        if ("streaming" in e.item && e.item.streaming)
          live.streaming.set(e.item.id, e.item);
        else live.streaming.delete(e.item.id);
        record(sessionId, e.item);
      } else if (e.type === "delta") {
        const item = live.streaming.get(e.id);
        if (item && "text" in item) item.text += e.text;
        emit(sessionId, { type: "delta", id: e.id, text: e.text });
      } else if (e.type === "resume_id") {
        // The agent's own conversation id, so the terminal can resume it too.
        db.prepare(
          `UPDATE sessions SET claude_session_id = ? WHERE id = ?`
        ).run(e.id, sessionId);
      } else if (e.type === "state") {
        setState(sessionId, live, e.state);
      }
    }
  } catch (error) {
    record(sessionId, {
      id: `error-${Date.now()}`,
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      createdAt: Date.now(),
    });
  } finally {
    for (const item of live.streaming.values())
      record(sessionId, settle([item])[0]);
    if (registry.live.get(sessionId) === live) registry.live.delete(sessionId);
    clearTimeout(live.idleTimer);
    emit(sessionId, { type: "state", state: "idle" });
  }
}

function ensureLive(session: Session): Live {
  const existing = registry.live.get(session.id);
  if (existing) return existing;
  const driver = chatDriverFor(session.agent_type);
  if (!driver)
    throw new Error(`${session.agent_type} sessions can't run as chat yet`);
  if (session.host_id && session.host_id !== "local") {
    throw new Error("Chat runs on this machine only for now");
  }
  const conversation = driver.start({
    cwd: session.working_directory.replace(/^~/, os.homedir()),
    model: resolveModelForAgent(session.agent_type, session.model),
    resumeId: session.claude_session_id,
    systemAppend: BUS_BRIEF,
    env: agentEnv(session.id),
  });
  const live: Live = { conversation, state: "idle", streaming: new Map() };
  registry.live.set(session.id, live);
  void pump(session.id, live);
  return live;
}

export function sendChat(
  sessionId: string,
  input: { text: string; images?: ChatImage[]; from?: string }
): void {
  const text = input.text.trim();
  if (!text && !input.images?.length) return;
  const live = ensureLive(getSession(sessionId));
  record(sessionId, {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "user",
    text,
    images: input.images,
    from: input.from,
    createdAt: Date.now(),
  });
  setState(sessionId, live, "running");
  db.prepare(
    `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
  ).run(sessionId);
  live.conversation.send(text, input.images);
}

export async function interruptChat(sessionId: string): Promise<void> {
  await registry.live.get(sessionId)?.conversation.interrupt();
}

export function stopChat(sessionId: string): void {
  const live = registry.live.get(sessionId);
  if (!live) return;
  registry.live.delete(sessionId);
  live.conversation.close();
}

export function chatState(sessionId: string): ChatState | null {
  return registry.live.get(sessionId)?.state ?? null;
}

// Snapshot then live updates. Returns the unsubscribe function.
export function watchChat(sessionId: string, listener: Listener): () => void {
  const live = registry.live.get(sessionId);
  let items = listItems(sessionId);
  if (live) {
    // Streaming items carry their latest text in memory, not yet in SQLite.
    items = items.map((i) => live.streaming.get(i.id) ?? i);
  } else {
    items = settle(items);
  }
  listener({ type: "snapshot", items, state: live?.state ?? "idle" });
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}
