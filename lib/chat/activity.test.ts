import { describe, expect, it } from "vitest";
import { stallOf, track } from "./activity";
import type { Live } from "./registry";
import type { WorkerEvent } from "./worker/protocol";

const MIN = 60_000;
const live = (): Live =>
  ({
    state: "running",
    activity: { tools: new Map(), tasks: new Set() },
  }) as unknown as Live;
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
    const first = stallOf(l, Date.now() + 9 * MIN, 8 * MIN);
    expect(first).not.toBeNull();
    track(l, ev({ type: "delta" }));
    expect(stallOf(l, Date.now() + 1000, 8 * MIN)).toBeNull();
    const second = stallOf(l, Date.now() + 9 * MIN, 8 * MIN);
    // A new stall has a new identity, so the orchestrator hears of it again.
    expect(second?.since).toBeGreaterThanOrEqual(first!.since);
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
