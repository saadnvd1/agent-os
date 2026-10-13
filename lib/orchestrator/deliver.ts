import type { ChatOrigin, ChatState } from "../chat/events";
import type { CompactFirst } from "../chat/stale";
import {
  isAnswer,
  isAwayEvent,
  deliveriesSince,
  type EventRow,
  lastDeliveredAt,
  logDeliveries,
  logSuppressed,
  markDelivered,
  pendingEvents,
  subjectNames,
  suppressedSince,
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

// Terminal and decision events are never capped: a merge, a gate refusal or
// failure, an escalation to Saad, a drop or close, a review verdict, an
// ask's answer. A finished task raises nothing after them, so a dropped one
// is gone for good. The cap is for repeating noise (CI green, stack steps).
const UNCAPPED = [
  "merged:",
  "blocked:",
  "stack:merged:",
  "stack:failed:",
  "stack-status:",
  "once:armed:", // merged, refused, failed, disarmed, closed
  "once:review:",
  "once:ask:",
  "once:conflict:",
  "once:plan-done:",
];
export const bypassesCap = (e: Pick<EventRow, "key">) =>
  UNCAPPED.some((p) => e.key.startsWith(p));

export const AGENTOS_SENDER = "agentos";

export type ChatSender = (
  sessionId: string,
  input: {
    text: string;
    from: string;
    origin: ChatOrigin;
    compact: CompactFirst;
  }
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
// the cheaper failure for a paid turn. (A condition that still holds is
// re-raised by the next change; a one-off event is not.)
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

  // Over a subject's hourly cap: dropped, not sent later, but logged as
  // suppressed and counted into the subject's next line. Terminal events
  // skip the cap.
  const counts = new Map<string, number>();
  const capped: EventRow[] = [];
  const pending = pendingEvents(workspaceId).filter((e) => {
    if (!e.subject || bypassesCap(e)) return true;
    const n =
      counts.get(e.subject) ??
      deliveriesSince(workspaceId, e.subject, now - HOUR);
    if (n >= SUBJECT_CAP) {
      capped.push(e);
      return false;
    }
    counts.set(e.subject, n + 1);
    return true;
  });
  if (capped.length) {
    markDelivered(
      capped.map((e) => e.id),
      now
    );
    logSuppressed(workspaceId, capped, now);
    console.warn(
      `[orchestrator] ${capped.length} event(s) over the hourly cap dropped: ${capped.map((e) => e.key).join(", ")}`
    );
  }
  if (!pending.length) return null;
  const oldestLow = Math.min(
    ...pending.filter((e) => e.low).map((e) => Date.parse(e.created_at))
  );
  if (pending.every((e) => e.low) && now - oldestLow < LOW_HOLD_MS) return null;

  const ids = pending.map((e) => e.id);
  const lines = [...new Set(pending.map((e) => e.line))];
  for (const subject of new Set(pending.map((e) => e.subject))) {
    const n = subject ? suppressedSince(workspaceId, subject, now - HOUR) : 0;
    if (n)
      lines.push(
        `(+${n} capped event${n === 1 ? "" : "s"} for ${subject} in the last hour)`
      );
  }
  const text = lines.join("\n");
  // Saad's answers to asks, shown in chat as his decisions.
  const decided = [...new Set(pending.filter(isAnswer).map((e) => e.line))];
  const subjects = subjectNames(pending.map((e) => e.subject));
  const origin: ChatOrigin = {
    kind: "event",
    label: "AgentOS",
    ...(subjects.length ? { subjects } : {}),
    ...(decided.length ? { decided } : {}),
    ...(pending.every((e) => isAwayEvent(e)) ? { away: true as const } : {}),
  };
  markDelivered(ids, now);
  const logged = logDeliveries(
    workspaceId,
    pending.map((e) => e.subject),
    now
  );
  try {
    await opts.send(opts.orchestratorId, {
      text,
      from: AGENTOS_SENDER,
      origin,
      // An orchestrator idle past its cache is compacted first.
      compact: "auto",
    });
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
