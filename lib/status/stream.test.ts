import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSnapshot } from "./collect";
import { createStream } from "./stream";

const snap = (
  statuses: Record<string, "idle" | "running">,
  hostErrors: Record<string, string> = {}
): StatusSnapshot => ({
  statuses: Object.fromEntries(
    Object.entries(statuses).map(([id, status]) => [
      id,
      { sessionName: id, status },
    ])
  ),
  hostErrors,
});

function client() {
  const seen: Record<string, unknown>[] = [];
  const fn = (json: string) => seen.push(JSON.parse(json));
  return { fn, seen };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("status stream", () => {
  it("holds a subscriber until there's a snapshot, then sends deltas in order", () => {
    const stream = createStream();
    const c = client();
    expect(stream.add(c.fn, undefined, null)).toBe(true);
    expect(c.seen).toEqual([]);
    stream.statuses(snap({ a: "idle", b: "idle" }));
    expect(c.seen).toMatchObject([{ type: "snapshot", seq: 0 }]);

    stream.statuses(snap({ a: "running" }, { box: "unreachable" }));
    expect(c.seen[1]).toEqual({
      type: "statuses",
      seq: 1,
      changed: { a: { sessionName: "a", status: "running" } },
      removed: ["b"],
      hostErrors: { box: "unreachable" },
    });
    // Nothing moved: nothing sent.
    stream.statuses(snap({ a: "running" }, { box: "unreachable" }));
    expect(c.seen).toHaveLength(2);
  });

  it("coalesces topics into one numbered message", () => {
    const stream = createStream(50);
    const c = client();
    stream.statuses(snap({}));
    stream.add(c.fn, undefined, null);
    stream.changed("stacks");
    stream.changed("stacks");
    stream.changed("sessions");
    vi.advanceTimersByTime(60);
    expect(c.seen.at(-1)).toEqual({
      type: "changed",
      seq: 1,
      topics: ["stacks", "sessions"],
    });
  });

  it("replays what a reconnecting client missed, if it's still kept", () => {
    const stream = createStream(0);
    const first = client();
    stream.statuses(snap({ a: "idle" }));
    stream.add(first.fn, undefined, null);
    stream.statuses(snap({ a: "running" }));
    const at = stream.position();
    stream.statuses(snap({ a: "idle" }));
    stream.changed("bus_messages");
    vi.advanceTimersByTime(1);

    const back = client();
    expect(stream.add(back.fn, at, null)).toBe(false);
    expect(back.seen.map((m) => [m.type, m.seq])).toEqual([
      ["statuses", 2],
      ["changed", 3],
    ]);
  });

  it("sends a snapshot instead when the client's place is gone", () => {
    const stream = createStream(0);
    stream.statuses(snap({ a: "idle" }));
    const keep = client();
    stream.add(keep.fn, undefined, null);
    const old = stream.position();
    for (let i = 0; i < 600; i++)
      stream.statuses(snap({ a: i % 2 ? "idle" : "running" }));

    const late = client();
    stream.add(late.fn, old, null);
    expect(late.seen).toMatchObject([{ type: "snapshot", seq: 600 }]);

    const other = client();
    stream.add(other.fn, { epoch: "another-run", seq: 600 }, null);
    expect(other.seen).toMatchObject([{ type: "snapshot" }]);

    // A position ahead of the stream isn't trusted either.
    const ahead = client();
    stream.add(ahead.fn, { ...stream.position(), seq: 9999 }, null);
    expect(ahead.seen).toMatchObject([{ type: "snapshot" }]);
  });

  it("replays from the oldest kept message, and not one before it", () => {
    const stream = createStream(0);
    stream.statuses(snap({ a: "idle" }));
    const keep = client();
    stream.add(keep.fn, undefined, null);
    for (let i = 0; i < 520; i++)
      stream.statuses(snap({ a: i % 2 ? "idle" : "running" }));
    // 520 messages, the last 512 kept: seq 9..520.
    const { epoch } = stream.position();
    const edge = client();
    stream.add(edge.fn, { epoch, seq: 8 }, null);
    expect(edge.seen).toHaveLength(512);
    expect(edge.seen[0]).toMatchObject({ type: "statuses", seq: 9 });
    const gone = client();
    stream.add(gone.fn, { epoch, seq: 7 }, null);
    expect(gone.seen).toMatchObject([{ type: "snapshot", seq: 520 }]);
  });

  it("starts a new epoch on reset, so nothing resumes across it", () => {
    const stream = createStream();
    stream.statuses(snap({ a: "idle" }));
    const before = stream.position();
    stream.reset();
    expect(stream.position().epoch).not.toBe(before.epoch);
    const c = client();
    expect(stream.add(c.fn, before, null)).toBe(true);
  });

  it("sends the latest load first to a new subscriber", () => {
    const stream = createStream();
    stream.statuses(snap({}));
    const c = client();
    stream.add(c.fn, undefined, JSON.stringify({ type: "load", load: 1 }));
    expect(c.seen.map((m) => m.type)).toEqual(["load", "snapshot"]);
  });
});
