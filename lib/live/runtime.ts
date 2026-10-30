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

/** A Drive prompt this machine took and hasn't seen finish. */
export interface DrivePrompt {
  id: string;
  guestId: string;
  // sending: on its way to the worker; queued: behind a turn; running.
  status: "sending" | "queued" | "running";
  // Why its turn was stopped, when it was (the guest's Stop, a cap).
  stopWhy?: string;
}

export interface DriveState {
  wheel: { guestId: string; wheel: string } | null;
  prompts: DrivePrompt[];
  // When prompts were taken, for the rate caps.
  accepted: number[];
  // Bumped whenever a Drive ends, so a send still on its way sends nothing.
  epoch: number;
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
  /** Connect locked the lobby until this time (ms) after wrong access codes. */
  codeLockedUntil: number | null;
  drops: number;
  drive: DriveState;
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
