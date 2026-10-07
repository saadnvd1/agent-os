/**
 * Session status, pushed. Whoever is subscribed (the /ws/status sockets) gets
 * the whole status map whenever it changes: at once when a chat changes
 * state or a program reports one (OSC 7501), and within about a second when
 * a terminal's screen does. Nothing runs while nobody is subscribed.
 */
import type { StatusSnapshot } from "./collect";

type Subscriber = (snapshot: string) => void;
type Collector = () => Promise<StatusSnapshot>;

interface Hub {
  subscribers: Set<Subscriber>;
  collector: Collector | null;
  // Says whether terminals changed since it was last asked.
  changed: (() => Promise<boolean>) | null;
  last: string | null;
  lastAt: number;
  running: boolean;
  again: boolean;
  soon: ReturnType<typeof setTimeout> | null;
  ticker: ReturnType<typeof setInterval> | null;
}

// Shared by the custom server and the Next.js route bundles: a chat state
// change or a report anywhere in the process reaches the same sockets.
const g = globalThis as unknown as { __agentosStatusHub?: Hub };
const hub: Hub = (g.__agentosStatusHub ??= {
  subscribers: new Set(),
  collector: null,
  changed: null,
  last: null,
  lastAt: 0,
  running: false,
  again: false,
  soon: null,
  ticker: null,
});

const TICK_MS = 1000;
// Even with no sign of change, look again this often (a seen session, a
// task, an orchestrator's asks).
const FULL_MS = 15000;
// Changes landing together (a tool call's pre and post hooks) go out once.
const COALESCE_MS = 50;

export function setStatusSource(
  collector: Collector,
  changed: () => Promise<boolean>
): void {
  hub.collector = collector;
  hub.changed = changed;
}

async function push(): Promise<void> {
  if (!hub.collector || hub.subscribers.size === 0) return;
  if (hub.running) {
    hub.again = true;
    return;
  }
  hub.running = true;
  try {
    do {
      hub.again = false;
      const json = JSON.stringify({
        type: "statuses",
        ...(await hub.collector()),
      });
      hub.lastAt = Date.now();
      if (json !== hub.last) {
        hub.last = json;
        hub.subscribers.forEach((fn) => fn(json));
      }
    } while (hub.again);
  } catch (err) {
    console.error("[status] push failed:", err);
  } finally {
    hub.running = false;
  }
}

/** Something changed a session's status: tell subscribers now. */
export function notifyStatusChanged(): void {
  if (hub.subscribers.size === 0 || hub.soon) return;
  hub.soon = setTimeout(() => {
    hub.soon = null;
    void push();
  }, COALESCE_MS);
}

async function tick(): Promise<void> {
  if (hub.running) return;
  try {
    const due = Date.now() - hub.lastAt >= FULL_MS;
    if (due || (await hub.changed?.())) await push();
  } catch (err) {
    console.error("[status] tick failed:", err);
  }
}

/** Every change from now on; the current map first. */
export function subscribeStatuses(fn: Subscriber): () => void {
  hub.subscribers.add(fn);
  if (hub.last) fn(hub.last);
  notifyStatusChanged();
  hub.ticker ??= setInterval(() => void tick(), TICK_MS);
  return () => {
    hub.subscribers.delete(fn);
    if (hub.subscribers.size === 0 && hub.ticker) {
      clearInterval(hub.ticker);
      hub.ticker = null;
      hub.last = null;
    }
  };
}
