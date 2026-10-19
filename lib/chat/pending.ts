import type { ChatFile, ChatImage, ChatState } from "./events";

// A message the composer sent that isn't in the chat or its queue yet. It
// shows as a bubble at once, and stays (as failed, with Retry) if it never
// arrives, so a long paste is never lost to a dead socket.
export interface PendingSend {
  id: string;
  text: string;
  images?: ChatImage[];
  files?: ChatFile[];
  compact?: boolean;
  // "sending": not taken in yet. "accepted": the server has it and is
  // starting the agent.
  status: "sending" | "accepted" | "failed";
  error?: string;
  // When it was last sent or accepted, for the timeouts below.
  at: number;
  // Sends so far; each reconnect resends once, up to MAX_SENDS.
  sends: number;
}

export type PendingAction =
  | {
      type: "add";
      send: Omit<PendingSend, "status" | "at" | "sends">;
      now: number;
    }
  // Sent again on a new socket, or by Retry.
  | { type: "resent"; id: string; now: number }
  | { type: "accepted"; id: string; now: number }
  | { type: "failed"; id: string; error: string }
  // Ids now in the chat or its queue: those sends are done.
  | { type: "resolved"; ids: Iterable<string> }
  | { type: "drop"; id: string }
  | { type: "tick"; now: number };

// No answer at all: the socket is likely dead though not yet closed.
export const SEND_TIMEOUT_MS = 10_000;
// Taken in but never shown: a new agent takes seconds, not a minute.
export const ACCEPTED_TIMEOUT_MS = 60_000;
export const MAX_SENDS = 3;

export const NOT_SENT = "connection lost";
const NO_ANSWER = "no answer from AgentOS";
const NEVER_ARRIVED = "the agent didn't take it";

export function pendingReducer(
  state: PendingSend[],
  action: PendingAction
): PendingSend[] {
  const update = (id: string, fn: (p: PendingSend) => PendingSend | null) => {
    const i = state.findIndex((p) => p.id === id);
    if (i === -1) return state;
    const next = fn(state[i]);
    if (next === state[i]) return state;
    const out = state.slice();
    if (next) out[i] = next;
    else out.splice(i, 1);
    return out;
  };
  switch (action.type) {
    case "add":
      if (state.some((p) => p.id === action.send.id)) return state;
      return [
        ...state,
        { ...action.send, status: "sending", at: action.now, sends: 1 },
      ];
    case "resent":
      return update(action.id, (p) => ({
        ...p,
        status: "sending",
        error: undefined,
        at: action.now,
        sends: p.sends + 1,
      }));
    case "accepted":
      return update(action.id, (p) =>
        p.status === "sending"
          ? { ...p, status: "accepted", at: action.now }
          : p
      );
    case "failed":
      return update(action.id, (p) => ({
        ...p,
        status: "failed",
        error: action.error,
      }));
    case "resolved": {
      const ids = new Set(action.ids);
      const kept = state.filter((p) => !ids.has(p.id));
      return kept.length === state.length ? state : kept;
    }
    case "drop":
      return update(action.id, () => null);
    case "tick": {
      let changed = false;
      const next = state.map((p) => {
        const limit =
          p.status === "sending"
            ? SEND_TIMEOUT_MS
            : p.status === "accepted"
              ? ACCEPTED_TIMEOUT_MS
              : Infinity;
        if (action.now - p.at < limit) return p;
        changed = true;
        return {
          ...p,
          status: "failed" as const,
          error: p.status === "sending" ? NO_ANSWER : NEVER_ARRIVED,
        };
      });
      return changed ? next : state;
    }
  }
}

// A compact-first send reads "Compacting first" from the server accepting it
// until compaction is over. The chat is idle in that gap (compaction starts
// it running), so idle means it hasn't begun; running with no compaction
// means it finished, or the server decided not to compact.
export const compactsFirst = (
  p: Pick<PendingSend, "status" | "compact">,
  chat: { state: ChatState; compacting: unknown }
) =>
  !!p.compact &&
  p.status === "accepted" &&
  (!!chat.compacting || chat.state === "idle");

// What a new socket sends again: anything not failed and not over its sends.
// Safe to repeat: the server drops an id already in the chat or its queue.
export const toResend = (state: PendingSend[]) =>
  state.filter((p) => p.status !== "failed" && p.sends < MAX_SENDS);

// A new socket that can't send again what's still pending marks it failed.
export const overSends = (state: PendingSend[]) =>
  state.filter((p) => p.status !== "failed" && p.sends >= MAX_SENDS);

// getRandomValues, not randomUUID: a phone on plain http over the tailnet
// isn't a secure context.
export const clientId = () =>
  `user-c-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")}`;

const keyFor = (sessionId: string) => `agentos:pending:${sessionId}`;

// Kept in this browser so a reload doesn't lose a failed article. Over
// quota, images go first and the words stay.
export function savePending(sessionId: string, state: PendingSend[]): void {
  try {
    const key = keyFor(sessionId);
    if (!state.length) return localStorage.removeItem(key);
    for (const kept of [
      state,
      state.map((p) => ({ ...p, images: undefined })),
    ]) {
      try {
        localStorage.setItem(key, JSON.stringify(kept));
        return;
      } catch {
        // Too big; try without images.
      }
    }
  } catch {
    // Storage unavailable.
  }
}

export function loadPending(sessionId: string): PendingSend[] {
  try {
    const raw = localStorage.getItem(keyFor(sessionId));
    const list = raw ? (JSON.parse(raw) as PendingSend[]) : [];
    // From an earlier page: each is sent once more on connecting.
    return Array.isArray(list)
      ? list.filter(
          (p) => typeof p?.id === "string" && typeof p.text === "string"
        )
      : [];
  } catch {
    return [];
  }
}
