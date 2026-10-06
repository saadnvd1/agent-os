import type { ChatState } from "../chat/events";
import { lastDeliveredAt, markDelivered, pendingEvents } from "./events";

// At most one message of events per workspace in this window.
export const BATCH_WINDOW_MS = 30 * 1000;

export const AGENTOS_SENDER = "agentos";

export type ChatSender = (
  sessionId: string,
  input: { text: string; from: string }
) => Promise<void>;

// Sends the workspace's queued events to its orchestrator as one message,
// unless a turn is running (they wait for it) or one went out too recently.
// Marked delivered before sending, so a restart mid-send can't send twice.
export async function deliverEvents(opts: {
  workspaceId: string;
  orchestratorId: string;
  turn: ChatState | null;
  send: ChatSender;
  now?: number;
}): Promise<string | null> {
  const now = opts.now ?? Date.now();
  if (opts.turn === "running" || opts.turn === "waiting") return null;
  const pending = pendingEvents(opts.workspaceId);
  if (!pending.length) return null;
  if (now - lastDeliveredAt(opts.workspaceId) < BATCH_WINDOW_MS) return null;

  const ids = pending.map((e) => e.id);
  const text = pending.map((e) => e.line).join("\n");
  markDelivered(ids, now);
  try {
    await opts.send(opts.orchestratorId, { text, from: AGENTOS_SENDER });
    return text;
  } catch (error) {
    markDelivered(ids, null);
    throw error;
  }
}
