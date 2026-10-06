import { db, type Session } from "../db";
import type { WorkerClient } from "./worker/client";
import type {
  ChatCommand,
  ChatItem,
  ChatModel,
  ChatServerMessage,
  ChatState,
} from "./events";

// A conversation whose worker this server is connected to.
export interface Live {
  worker: WorkerClient;
  state: ChatState;
  // Streamed items carry their latest text here, ahead of SQLite.
  streaming: Map<string, ChatItem>;
  // What the turn is doing right now, for the session list.
  activity: ChatActivity;
}

export interface ChatActivity {
  turnStartedAt?: number;
  // Running tool calls by id: their label and when they started.
  tools: Map<string, { label: string; since: number }>;
  // Running background tasks (not housekeeping ones).
  tasks: Set<string>;
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
  connecting: Map<string, Promise<Live>>;
  listeners: Map<string, Set<Listener>>;
  // What each agent offers per folder: commands, skills, models.
  caps: Map<string, Capabilities>;
}

// Shared across every module instance in the process (custom server and the
// Next.js route bundles each load their own copy of this file).
const g = globalThis as unknown as { __agentosChat?: Registry };
export const registry: Registry = (g.__agentosChat ??= {
  live: new Map(),
  connecting: new Map(),
  listeners: new Map(),
  caps: new Map(),
});
registry.caps ??= new Map();
registry.connecting ??= new Map();

export function emit(sessionId: string, m: ChatServerMessage): void {
  registry.listeners.get(sessionId)?.forEach((fn) => fn(m));
}

export function getSession(sessionId: string): Session {
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
  if (!s) throw new Error("Session not found");
  return s;
}
