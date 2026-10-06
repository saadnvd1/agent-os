import type { ChatState } from "../chat/events";
import {
  deliveriesSince,
  lastDeliveredAt,
  logDeliveries,
  markDelivered,
  pendingEvents,
  unlogDeliveries,
} from "./events";
import { isPaused } from "./pause";

// At most one message of events per workspace in this window.
export const BATCH_WINDOW_MS = 30 * 1000;
// Low-value events (idle) wait for a batch going anyway, or this long.
export const LOW_HOLD_MS = 10 * 60 * 1000;
// No subject gets more than this many events an hour.
export const SUBJECT_CAP = 6;
const HOUR = 60 * 60 * 1000;

export const AGENTOS_SENDER = "agentos";

export type ChatSender = (
  sessionId: string,
  input: { text: string; from: string }
) => Promise<void>;

// After a failed send, wait 5s, then 10s, 20s ... up to 5 minutes.
export function backoffMs(failures: number): number {
  return Math.min(5000 * 2 ** Math.max(0, failures - 1), 5 * 60 * 1000);
}

const failing = new Map<string, { failures: number; until: number }>();

// Sends the workspace's ready events to its orchestrator as one message,
// unless it's paused (they queue until Resume), a turn is running (they wait
// for it), one went out too recently, or the last send failed and its
// backoff hasn't passed. The same line twice goes once.
//
// Rows are marked delivered before the send so a restart can't send them
// twice. The cost: if the process dies between marking and the send
// reaching the worker, those events are lost rather than repeated. That's
// the cheaper failure for a paid turn, and the next change re-raises them.
export async function deliverEvents(opts: {
  workspaceId: string;
  orchestratorId: string;
  turn: ChatState | null;
  send: ChatSender;
  now?: number;
}): Promise<string | null> {
  const now = opts.now ?? Date.now();
  const { workspaceId } = opts;
  if (isPaused(workspaceId)) return null;
  if (opts.turn === "running" || opts.turn === "waiting") return null;
  if ((failing.get(workspaceId)?.until ?? 0) > now) return null;
  if (now - lastDeliveredAt(workspaceId) < BATCH_WINDOW_MS) return null;

  // Over a subject's hourly cap: dropped, not sent later.
  const counts = new Map<string, number>();
  const capped: number[] = [];
  const pending = pendingEvents(workspaceId).filter((e) => {
    if (!e.subject) return true;
    const n =
      counts.get(e.subject) ??
      deliveriesSince(workspaceId, e.subject, now - HOUR);
    if (n >= SUBJECT_CAP) {
      capped.push(e.id);
      return false;
    }
    counts.set(e.subject, n + 1);
    return true;
  });
  if (capped.length) markDelivered(capped, now);
  if (!pending.length) return null;
  const oldestLow = Math.min(
    ...pending.filter((e) => e.low).map((e) => Date.parse(e.created_at))
  );
  if (pending.every((e) => e.low) && now - oldestLow < LOW_HOLD_MS) return null;

  const ids = pending.map((e) => e.id);
  const text = [...new Set(pending.map((e) => e.line))].join("\n");
  markDelivered(ids, now);
  const logged = logDeliveries(
    workspaceId,
    pending.map((e) => e.subject),
    now
  );
  try {
    await opts.send(opts.orchestratorId, { text, from: AGENTOS_SENDER });
    failing.delete(workspaceId);
    return text;
  } catch (error) {
    markDelivered(ids, null);
    unlogDeliveries(logged);
    const failures = (failing.get(workspaceId)?.failures ?? 0) + 1;
    failing.set(workspaceId, { failures, until: now + backoffMs(failures) });
    throw error;
  }
}
