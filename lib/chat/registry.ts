import { db, type Session } from "../db";
import type { ChatConversation } from "./driver";
import type {
  ChatCommand,
  ChatItem,
  ChatModel,
  ChatServerMessage,
  ChatState,
} from "./events";
import { saveItem } from "./store";

export interface Live {
  conversation: ChatConversation;
  state: ChatState;
  streaming: Map<string, ChatItem>;
  idleTimer?: NodeJS.Timeout;
}

export type Listener = (m: ChatServerMessage) => void;

export interface Capabilities {
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

// Shared across every module instance in the process (custom server and the
// Next.js route bundles each load their own copy of this file).
const g = globalThis as unknown as { __agentosChat?: Registry };
export const registry: Registry = (g.__agentosChat ??= {
  live: new Map(),
  listeners: new Map(),
  caps: new Map(),
});
registry.caps ??= new Map();

export function emit(sessionId: string, m: ChatServerMessage): void {
  registry.listeners.get(sessionId)?.forEach((fn) => fn(m));
}

export function record(sessionId: string, item: ChatItem): void {
  saveItem(sessionId, item);
  emit(sessionId, { type: "item", item });
}

export function getSession(sessionId: string): Session {
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
  if (!s) throw new Error("Session not found");
  return s;
}
