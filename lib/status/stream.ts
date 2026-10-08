import { randomUUID } from "crypto";
import type { StatusSnapshot } from "./collect";

/**
 * The numbered side of the status hub. A subscriber gets
 *   {type:"snapshot", epoch, seq, statuses, hostErrors}
 * then messages each one higher in seq:
 *   {type:"statuses", seq, changed, removed, hostErrors?}  sessions that moved
 *   {type:"changed", seq, topics}                          refetch these
 * A client that reconnects says the epoch and seq it last saw; when the
 * messages after it are still kept it gets just those, otherwise a fresh
 * snapshot (and refetches what it shows, since it may have missed topics).
 * The epoch changes whenever the history it numbers is dropped.
 */

export type StreamSubscriber = (json: string) => void;

// Messages kept for resuming: a phone away for a minute or two of changes.
const KEEP = 512;
const COALESCE_MS = 50;

export interface Stream {
  size(): number;
  /** True when it waits for the next collected snapshot. */
  add(
    fn: StreamSubscriber,
    resume: { epoch: string; seq: number } | undefined,
    load: string | null
  ): boolean;
  remove(fn: StreamSubscriber): void;
  statuses(snapshot: StatusSnapshot): void;
  changed(topic: string): void;
  load(json: string): void;
  reset(): void;
  position(): { epoch: string; seq: number };
}

export function createStream(coalesceMs = COALESCE_MS): Stream {
  let epoch = randomUUID();
  let seq = 0;
  let kept: { seq: number; json: string }[] = [];
  let statuses: StatusSnapshot["statuses"] | null = null;
  let hostErrors: StatusSnapshot["hostErrors"] = {};
  let byId = new Map<string, string>();
  const subscribers = new Set<StreamSubscriber>();
  // Joined before there was a snapshot to give them.
  const waiting = new Set<StreamSubscriber>();
  const topics = new Set<string>();
  let flush: ReturnType<typeof setTimeout> | null = null;

  const emit = (body: Record<string, unknown>) => {
    seq++;
    const json = JSON.stringify({ ...body, seq });
    kept.push({ seq, json });
    if (kept.length > KEEP) kept.shift();
    for (const fn of subscribers) if (!waiting.has(fn)) fn(json);
  };
  const snapshot = (fn: StreamSubscriber) =>
    fn(JSON.stringify({ type: "snapshot", epoch, seq, statuses, hostErrors }));
  const resumable = (r?: { epoch: string; seq: number }) =>
    !!r &&
    r.epoch === epoch &&
    Number.isInteger(r.seq) &&
    r.seq <= seq &&
    (r.seq === seq || (kept.length > 0 && kept[0].seq <= r.seq + 1));

  return {
    size: () => subscribers.size,
    add(fn, resume, load) {
      subscribers.add(fn);
      if (load) fn(load);
      if (resumable(resume)) {
        for (const m of kept) if (m.seq > resume!.seq) fn(m.json);
        return false;
      }
      if (statuses) {
        snapshot(fn);
        return false;
      }
      waiting.add(fn);
      return true;
    },
    remove(fn) {
      subscribers.delete(fn);
      waiting.delete(fn);
    },
    statuses(next) {
      const ids = new Map<string, string>();
      const changed: StatusSnapshot["statuses"] = {};
      for (const [id, status] of Object.entries(next.statuses)) {
        const json = JSON.stringify(status);
        ids.set(id, json);
        if (byId.get(id) !== json) changed[id] = status;
      }
      const removed = [...byId.keys()].filter((id) => !ids.has(id));
      const hostsMoved =
        JSON.stringify(next.hostErrors) !== JSON.stringify(hostErrors);
      const first = statuses === null;
      byId = ids;
      statuses = next.statuses;
      hostErrors = next.hostErrors;
      if (
        !first &&
        (Object.keys(changed).length || removed.length || hostsMoved)
      )
        emit({
          type: "statuses",
          changed,
          removed,
          ...(hostsMoved ? { hostErrors } : {}),
        });
      for (const fn of waiting) snapshot(fn);
      waiting.clear();
    },
    changed(topic) {
      if (!subscribers.size) return;
      topics.add(topic);
      flush ??= setTimeout(() => {
        flush = null;
        const list = [...topics];
        topics.clear();
        if (subscribers.size) emit({ type: "changed", topics: list });
      }, coalesceMs);
    },
    load(json) {
      for (const fn of subscribers) if (!waiting.has(fn)) fn(json);
    },
    reset() {
      epoch = randomUUID();
      seq = 0;
      kept = [];
      statuses = null;
      hostErrors = {};
      byId = new Map();
      topics.clear();
      if (flush) clearTimeout(flush);
      flush = null;
    },
    position: () => ({ epoch, seq }),
  };
}
