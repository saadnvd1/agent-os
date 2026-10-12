import { noteWaiting } from "../notify/push/waiting";
import { db, type Session } from "../db";
import type { WorkerClient } from "./worker/client";
import { notifyStatusChanged } from "../status/hub";
import type {
  ChatCommand,
  ChatItem,
  ChatModel,
  ChatServerMessage,
  ChatState,
  Compacting,
} from "./events";
import { markStatusDirty } from "../status/dirty";
import { FLUSH_MS } from "./store";

// Long enough for the worker's buffered write of an item to land.
const EMIT_SETTLE_MS = 2 * FLUSH_MS;

// A conversation whose worker this server is connected to.
export interface Live {
  worker: WorkerClient;
  state: ChatState;
  // Set while its agent compacts the context, over a "running" state.
  compacting?: Compacting | null;
  // Streamed items carry their latest text here, ahead of SQLite.
  streaming: Map<string, ChatItem>;
  // What the turn is doing right now, for the session list.
  activity: ChatActivity;
  // The build its worker runs (lib/build).
  build?: string;
  // Whether it can switch plan mode (a worker from before plan mode can't).
  canPlan: boolean;
  // Whether it keeps the composer's queue and answers @mention lookups
  // (send_now, drain, files); an older worker drops those silently.
  canQueue?: boolean;
  // Whether it takes "fresh" (a fresh start the reader asked for).
  canFresh?: boolean;
  // From an older build and idle: retired once its guess at the next
  // message is in, or this fires.
  retiring?: NodeJS.Timeout;
  // From an older build, and told to retire itself at its next turn
  // boundary (a worker that understands "retire" does it alone).
  retireSent?: boolean;
}

export interface ChatActivity {
  turnStartedAt?: number;
  // When the turn last produced anything (a token, an item, a tool result)
  // and what that was; unset between turns. Silence from here is a stall.
  lastAt?: number;
  lastWhat?: string;
  // Messages the user side has sent this conversation: a change while a stop
  // waits means a new turn began, which the stop must leave alone.
  sends?: number;
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
  // Items come from the worker, which writes them a moment after saying so.
  if (m.type === "state" || m.type === "compacting" || m.type === "item")
    markStatusDirty(sessionId, EMIT_SETTLE_MS);
  if (m.type === "state") noteWaiting(sessionId, m.state === "waiting");
  registry.listeners.get(sessionId)?.forEach((fn) => fn(m));
  // Idle, running, waiting and back, and a finished turn (unread): the
  // sidebar hears at once.
  if (
    m.type === "state" ||
    m.type === "compacting" ||
    (m.type === "item" && m.item.kind === "turn_end")
  )
    notifyStatusChanged();
}

export function getSession(sessionId: string): Session {
  const s = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    | Session
    | undefined;
  if (!s) throw new Error("Session not found");
  return s;
}
