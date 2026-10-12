import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatActivityLine, stallOf, track } from "./activity";
import { registry, type Live } from "./registry";
import type { WorkerEvent } from "./worker/protocol";

const MIN = 60_000;
const live = (): Live =>
  ({
    state: "running",
    activity: { tools: new Map(), tasks: new Set() },
  }) as unknown as Live;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000_000);
});
afterEach(() => vi.useRealTimers());
const ev = (e: unknown) => e as WorkerEvent;

describe("stall detection", () => {
  it("fires once the turn has been silent for the threshold, naming the last action", () => {
    const l = live();
    const t0 = Date.now();
    track(l, ev({ type: "state", state: "running" }));
    track(l, ev({ type: "delta" }));
    expect(stallOf(l, t0 + 7 * MIN, 8 * MIN)).toBeNull();
    const s = stallOf(l, t0 + 9 * MIN, 8 * MIN);
    expect(s?.last).toBe("writing");
    expect(s?.silentMs).toBeGreaterThanOrEqual(8 * MIN);
  });

  it("never fires while output keeps flowing, and a stall resets on activity", () => {
    const l = live();
    track(l, ev({ type: "state", state: "running" }));
    vi.advanceTimersByTime(9 * MIN);
    const first = stallOf(l, Date.now(), 8 * MIN);
    expect(first).not.toBeNull();
    track(l, ev({ type: "delta" }));
    vi.advanceTimersByTime(MIN);
    expect(stallOf(l, Date.now(), 8 * MIN)).toBeNull();
    vi.advanceTimersByTime(9 * MIN);
    const second = stallOf(l, Date.now(), 8 * MIN);
    // A new stall has a new identity, so the orchestrator hears of it again.
    expect(second?.since).toBeGreaterThan(first!.since);
  });

  it("gives a foreground tool call a much longer allowance", () => {
    const l = live();
    track(l, ev({ type: "state", state: "running" }));
    l.activity.tools.set("t", { label: "Run tests", since: Date.now() });
    vi.advanceTimersByTime(20 * MIN);
    expect(stallOf(l, Date.now(), 8 * MIN)).toBeNull();
    vi.advanceTimersByTime(15 * MIN);
    expect(stallOf(l, Date.now(), 8 * MIN)).not.toBeNull();
  });

  it("ignores a session waiting on a background task, an answer, or no turn", () => {
    const l = live();
    track(l, ev({ type: "state", state: "running" }));
    const late = Date.now() + 30 * MIN;
    l.activity.tasks.add("bg");
    expect(stallOf(l, late, 8 * MIN)).toBeNull();
    l.activity.tasks.clear();
    l.state = "waiting";
    expect(stallOf(l, late, 8 * MIN)).toBeNull();
    l.state = "idle";
    track(l, ev({ type: "state", state: "idle" }));
    expect(stallOf(l, late, 8 * MIN)).toBeNull();
  });

  it("is off at a threshold of 0", () => {
    const l = live();
    track(l, ev({ type: "state", state: "running" }));
    expect(stallOf(l, Date.now() + 60 * MIN, 0)).toBeNull();
  });
});

describe("a compacting chat", () => {
  const compacting = (before?: number): Live =>
    ({
      state: "running",
      compacting: { since: Date.now() - 40_000, before },
      activity: { tools: new Map(), tasks: new Set() },
    }) as unknown as Live;

  it("reads as compacting, with the size going in, not as work", () => {
    registry.live.set("s1", compacting(182_000));
    expect(chatActivityLine("s1")).toBe(
      "Compacting context (182k tokens) · 40s"
    );
    registry.live.set("s1", compacting());
    expect(chatActivityLine("s1")).toBe("Compacting context · 40s");
    registry.live.delete("s1");
  });

  it("is never flagged stalled, however long it stays silent", () => {
    const l = compacting(1);
    track(l, ev({ type: "state", state: "running" }));
    expect(stallOf(l, Date.now() + 60 * MIN, 8 * MIN)).toBeNull();
  });
});
