import type { ChatItem } from "../chat/events";
import type { ShareContext } from "../share/redact";
import type { LiveShareRow } from "./store";
import type { ItemMapper } from "./frames";
import { Ring } from "./ring";
import type { LiveSocket } from "./socket";

export interface Guest {
  id: string;
  name: string;
  /** pending: waiting in the lobby. admitted: let in by this machine. */
  status: "pending" | "admitted";
  online: boolean;
  /** When the request arrived, for the 10-minute lobby expiry. */
  at: number;
}

/** What one live share holds in memory; everything durable is in the log. */
export interface Runtime {
  share: LiveShareRow;
  guests: Map<string, Guest>;
  ring: Ring;
  ctx: ShareContext;
  map: ItemMapper;
  /** Accumulated text of assistant items still streaming, by item id. */
  streaming: Map<string, { item: ChatItem; text: string }>;
  /** Items waiting for the next flush, by id (latest wins). */
  dirty: Map<string, { item: ChatItem; text?: string }>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  slowUntil: number;
  notice: string | null;
  drops: number;
}

export interface LiveGlobals {
  runtimes: Map<string, Runtime>;
  socket: LiveSocket | null;
  started: boolean;
}

// One per process, shared by the custom server and the route bundles.
const g = globalThis as unknown as { __agentosLive?: LiveGlobals };
export const live: LiveGlobals = (g.__agentosLive ??= {
  runtimes: new Map(),
  socket: null,
  started: false,
});

export const LOBBY_MS = 10 * 60_000;
export const MAX_PENDING_CARDS = 20;
export const MAX_LOBBY = 10;
