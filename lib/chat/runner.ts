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
  ChatCommand,
  ChatImage,
  ChatItem,
  ChatModel,
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
interface Capabilities {
  commands: ChatCommand[];
  models: ChatModel[];
  terminalOnly: Set<string>;
  at: number;
}

interface Registry {
  live: Map<string, Live>;
  listeners: Map<string, Set<Listener>>;
  // What each agent offers per folder: commands, skills, models.
  caps: Map<string, Capabilities>;
}
const g = globalThis as unknown as { __agentosChat?: Registry };
const registry: Registry = (g.__agentosChat ??= {
  live: new Map(),
  listeners: new Map(),
  caps: new Map(),
});
registry.caps ??= new Map();

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
      } else if (e.type === "commands" || e.type === "terminal_only") {
        const session = getSession(sessionId);
        const caps = registry.caps.get(capsKey(session));
        if (caps) {
          if (e.type === "commands") caps.commands = e.commands;
          else e.names.forEach((n) => caps.terminalOnly.add(n));
          emitCapabilities(session);
        }
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
    model: chatModel(session),
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
  void sendCapabilities(sessionId, listener);
  let set = registry.listeners.get(sessionId);
  if (!set) registry.listeners.set(sessionId, (set = new Set()));
  set.add(listener);
  return () => set?.delete(listener);
}

// ── Commands, skills and models ──────────────────────────────────────────

const CAPS_TTL_MS = 10 * 60 * 1000;

// Commands that only make sense in a terminal UI, hidden from chat when the
// agent doesn't say so itself.
const TERMINAL_ONLY = new Set([
  "exit",
  "quit",
  "statusline",
  "terminal-setup",
  "vim",
  "color",
  "theme",
  "ide",
  "heapdump",
  "config",
  "resume",
  "login",
  "logout",
]);

const capsKey = (s: Session) => `${s.agent_type}:${s.working_directory}`;

// The session's own model when it has one; the agent's default otherwise.
function chatModel(session: Session): string {
  return (
    session.model?.trim() || resolveModelForAgent(session.agent_type, null)
  );
}

function visibleCommands(caps: Capabilities): ChatCommand[] {
  return caps.commands.filter(
    (c) =>
      !c.name.startsWith("__") &&
      !caps.terminalOnly.has(c.name) &&
      !TERMINAL_ONLY.has(c.name)
  );
}

function emitCapabilities(session: Session, listener?: Listener): void {
  const caps = registry.caps.get(capsKey(session));
  if (!caps) return;
  const m: ChatServerMessage = {
    type: "capabilities",
    commands: visibleCommands(caps),
    models: caps.models,
    model: chatModel(session),
  };
  if (listener) listener(m);
  else emit(session.id, m);
}

async function loadCapabilities(session: Session): Promise<void> {
  const key = capsKey(session);
  const cached = registry.caps.get(key);
  if (cached && Date.now() - cached.at < CAPS_TTL_MS) return;
  const driver = chatDriverFor(session.agent_type);
  if (!driver) return;
  const found = await driver.discover({
    cwd: session.working_directory.replace(/^~/, os.homedir()),
    env: agentEnv(session.id),
  });
  registry.caps.set(key, {
    ...found,
    terminalOnly: cached?.terminalOnly ?? new Set(),
    at: Date.now(),
  });
}

// Sends what the agent offers to one watcher, loading it if needed.
export async function sendCapabilities(
  sessionId: string,
  listener: Listener
): Promise<void> {
  const session = getSession(sessionId);
  if (session.host_id && session.host_id !== "local") return;
  try {
    await loadCapabilities(session);
  } catch (error) {
    console.error("Could not load chat commands:", error);
  }
  emitCapabilities(session, listener);
}

// Switches the model now if a conversation is live, and for every next start.
export async function setChatModel(
  sessionId: string,
  model: string
): Promise<void> {
  const value = model.trim();
  if (!value) return;
  db.prepare(`UPDATE sessions SET model = ? WHERE id = ?`).run(
    value,
    sessionId
  );
  await registry.live.get(sessionId)?.conversation.setModel(value);
  emitCapabilities(getSession(sessionId));
}
