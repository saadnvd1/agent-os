/**
 * Session status and what changed, pushed. Whoever is subscribed (the
 * /ws/status sockets) hears at once when a chat changes state or a program
 * reports one (OSC 7501), within about a second when a terminal's screen
 * does, and when a watched table changes (lib/db/changes.ts) or a pushed
 * view moves (setTopicSignature). Nothing runs while nobody is subscribed.
 *
 * Two kinds of subscriber. A "stream" subscriber (lib/status/stream.ts) gets
 * a snapshot, then numbered deltas it can resume from after a reconnect. A
 * plain one gets the whole status map on every change, as before.
 */
import type { StatusSnapshot } from "./collect";
import { createStream, type Stream, type StreamSubscriber } from "./stream";

type Subscriber = (snapshot: string) => void;
type Collector = () => Promise<StatusSnapshot>;
type TerminalCheck = () => Promise<"changed" | "busy" | null>;
// Tables whose rows changed since the last call, or null on the first.
type TableCheck = () => string[];

interface Hub {
  subscribers: Set<Subscriber>;
  stream: Stream;
  collector: Collector | null;
  // Says whether terminals changed since it was last asked.
  changed: TerminalCheck | null;
  tables: TableCheck | null;
  signatures: Map<string, { read: () => string; last?: string }>;
  // Sessions running at the last collect, to see a run finish.
  runningIds: Set<string>;
  onRunFinished: ((sessionId: string) => void) | null;
  last: string | null;
  // The machine-load message (lib/load), resent to each new subscriber.
  lastLoad?: string | null;
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
  stream: createStream(),
  collector: null,
  changed: null,
  tables: null,
  signatures: new Map(),
  runningIds: new Set(),
  onRunFinished: null,
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
// A terminal that only still looks busy is looked at again this often (the
// screen-reading cooldown is 2s); new output is looked at on the next tick.
const BUSY_MS = 3000;
// Changes landing together (a tool call's pre and post hooks) go out once.
const COALESCE_MS = 50;

export function setStatusSource(
  collector: Collector,
  changed: TerminalCheck,
  tables?: TableCheck
): void {
  hub.collector = collector;
  hub.changed = changed;
  hub.tables = tables ?? null;
}

/** Called for each session whose run finished (running, then not). */
export function setRunFinished(fn: (sessionId: string) => void): void {
  hub.onRunFinished = fn;
}

function runsFinished(snapshot: StatusSnapshot): void {
  const now = new Set(
    Object.entries(snapshot.statuses)
      .filter(([, s]) => s.status === "running")
      .map(([id]) => id)
  );
  for (const id of hub.runningIds)
    if (!now.has(id))
      try {
        hub.onRunFinished?.(id);
      } catch (err) {
        console.error("[status] run-finished hook failed:", err);
      }
  hub.runningIds = now;
}

/** A pushed view whose `read()` changing means subscribers refetch `topic`. */
export function setTopicSignature(topic: string, read: () => string): void {
  hub.signatures.set(topic, { read });
}

const watching = () => hub.subscribers.size + hub.stream.size() > 0;

async function push(): Promise<void> {
  if (!hub.collector || !watching()) return;
  if (hub.running) {
    hub.again = true;
    return;
  }
  hub.running = true;
  try {
    do {
      hub.again = false;
      const snapshot = await hub.collector();
      hub.lastAt = Date.now();
      runsFinished(snapshot);
      hub.stream.statuses(snapshot);
      if (hub.subscribers.size) {
        const json = JSON.stringify({ type: "statuses", ...snapshot });
        if (json !== hub.last) {
          hub.last = json;
          hub.subscribers.forEach((fn) => fn(json));
        }
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
  if (!watching() || hub.soon) return;
  hub.soon = setTimeout(() => {
    hub.soon = null;
    void push();
  }, COALESCE_MS);
}

/** What `topic` names changed: stream subscribers refetch it. */
export function notifyTopic(topic: string): void {
  hub.stream.changed(topic);
}

/** A session was renamed or added: subscribers refetch the list now. */
export function notifySessionsChanged(): void {
  const json = JSON.stringify({ type: "sessions" });
  hub.subscribers.forEach((fn) => fn(json));
  hub.stream.changed("sessions");
}

// Tables that moved, or none when they can't be read this time.
function movedTables(): string[] {
  try {
    return hub.tables?.() ?? [];
  } catch (err) {
    console.error("[status] reading table changes failed:", err);
    return [];
  }
}

function checkTopics(): void {
  if (!hub.stream.size()) return;
  for (const table of movedTables()) hub.stream.changed(table);
  for (const [topic, sig] of hub.signatures) {
    let now: string;
    try {
      now = sig.read();
    } catch {
      continue;
    }
    if (sig.last !== undefined && sig.last !== now) hub.stream.changed(topic);
    sig.last = now;
  }
}

async function tick(): Promise<void> {
  checkTopics();
  if (hub.running) return;
  try {
    const since = Date.now() - hub.lastAt;
    const terminals = await hub.changed?.();
    if (
      since >= FULL_MS ||
      terminals === "changed" ||
      (terminals === "busy" && since >= BUSY_MS)
    )
      await push();
  } catch (err) {
    console.error("[status] tick failed:", err);
  }
}

/** The machine load changed: subscribers get it, and new ones on connect. */
export function publishLoad(json: string): void {
  if (json === hub.lastLoad) return;
  hub.lastLoad = json;
  hub.subscribers.forEach((fn) => fn(json));
  hub.stream.load(json);
}

function started(): void {
  if (hub.ticker) return;
  // Changes from before anyone watched don't count: a new subscriber's
  // snapshot (or first fetch) already has them.
  movedTables();
  for (const sig of hub.signatures.values()) sig.last = undefined;
  checkTopics();
  hub.ticker = setInterval(() => void tick(), TICK_MS);
}

function stopped(): void {
  if (watching() || !hub.ticker) return;
  clearInterval(hub.ticker);
  hub.ticker = null;
  hub.last = null;
  hub.runningIds = new Set();
  // Nothing was watched from here on, so nothing can be resumed across it.
  hub.stream.reset();
}

/** Every change from now on; the current map first. */
export function subscribeStatuses(fn: Subscriber): () => void {
  hub.subscribers.add(fn);
  if (hub.last) fn(hub.last);
  if (hub.lastLoad) fn(hub.lastLoad);
  started();
  notifyStatusChanged();
  return () => {
    hub.subscribers.delete(fn);
    stopped();
  };
}

/**
 * Numbered deltas from `resume` (the epoch and last seq a reconnecting
 * client saw) when they're still kept, else a snapshot first.
 */
export function subscribeStream(
  fn: StreamSubscriber,
  resume?: { epoch: string; seq: number }
): () => void {
  const fresh = hub.stream.add(fn, resume, hub.lastLoad ?? null);
  started();
  if (fresh) notifyStatusChanged();
  return () => {
    hub.stream.remove(fn);
    stopped();
  };
}
