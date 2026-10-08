import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSnapshot } from "./collect";
import {
  notifyStatusChanged,
  notifySessionsChanged,
  setRunFinished,
  setStatusSource,
  setTopicSignature,
  subscribeStatuses,
  subscribeStream,
} from "./hub";

let version = 0;
let terminals: "changed" | "busy" | null = null;
const collector = vi.fn(
  async (): Promise<StatusSnapshot> => ({
    statuses: {
      s: { sessionName: "s", status: version % 2 ? "running" : "idle" },
    },
    hostErrors: {},
  })
);
const unsubscribers: (() => void)[] = [];
const subscribe = () => {
  const seen: string[] = [];
  unsubscribers.push(subscribeStatuses((json) => seen.push(json)));
  return seen;
};
const statusOf = (json: string) => JSON.parse(json).statuses.s.status;

beforeEach(() => {
  vi.useFakeTimers();
  version = 0;
  terminals = null;
  collector.mockClear();
  tablesMoved = [];
  setStatusSource(
    collector,
    async () => terminals,
    () => tablesMoved.splice(0)
  );
});

let tablesMoved: string[] = [];

afterEach(() => {
  unsubscribers.splice(0).forEach((off) => off());
  vi.useRealTimers();
});

describe("status hub", () => {
  it("sends a new subscriber the map, then one push per burst of changes", async () => {
    const seen = subscribe();
    await vi.advanceTimersByTimeAsync(60);
    expect(seen.map(statusOf)).toEqual(["idle"]);
    expect(collector).toHaveBeenCalledTimes(1);

    version = 1;
    notifyStatusChanged();
    notifyStatusChanged();
    notifyStatusChanged();
    await vi.advanceTimersByTimeAsync(60);
    expect(collector).toHaveBeenCalledTimes(2);
    expect(seen.map(statusOf)).toEqual(["idle", "running"]);
  });

  it("doesn't resend a map that hasn't changed", async () => {
    const seen = subscribe();
    await vi.advanceTimersByTimeAsync(60);
    notifyStatusChanged();
    await vi.advanceTimersByTimeAsync(60);
    expect(collector).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(1);
  });

  it("looks again when a change lands mid-collection", async () => {
    let release!: () => void;
    collector.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (release = r));
      return {
        statuses: { s: { sessionName: "s", status: "idle" } },
        hostErrors: {},
      };
    });
    const seen = subscribe();
    await vi.advanceTimersByTimeAsync(60);
    version = 1;
    notifyStatusChanged();
    await vi.advanceTimersByTimeAsync(60);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(collector).toHaveBeenCalledTimes(2);
    expect(seen.map(statusOf)).toEqual(["idle", "running"]);
  });

  it("looks at terminals on the tick: at once on output, every 3s while busy", async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(60);
    expect(collector).toHaveBeenCalledTimes(1);
    terminals = "busy";
    // Ticks at 1s and 2s after the first push: too soon to look again.
    await vi.advanceTimersByTimeAsync(2000);
    expect(collector).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(collector).toHaveBeenCalledTimes(2);
    terminals = "changed";
    await vi.advanceTimersByTimeAsync(1000);
    expect(collector).toHaveBeenCalledTimes(3);
  });

  it("stops looking once nobody is subscribed", async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(60);
    unsubscribers.splice(0).forEach((off) => off());
    terminals = "changed";
    notifyStatusChanged();
    await vi.advanceTimersByTimeAsync(30000);
    expect(collector).toHaveBeenCalledTimes(1);
  });
});

describe("status hub: the numbered stream", () => {
  const stream = () => {
    const seen: Record<string, unknown>[] = [];
    unsubscribers.push(subscribeStream((json) => seen.push(JSON.parse(json))));
    return seen;
  };

  it("snapshots, then sends status deltas and changed tables", async () => {
    const seen = stream();
    await vi.advanceTimersByTimeAsync(60);
    expect(seen).toMatchObject([{ type: "snapshot", seq: 0 }]);

    version = 1;
    notifyStatusChanged();
    await vi.advanceTimersByTimeAsync(60);
    expect(seen[1]).toMatchObject({
      type: "statuses",
      seq: 1,
      changed: { s: { status: "running" } },
    });

    tablesMoved = ["stacks"];
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen.find((m) => m.type === "changed")).toMatchObject({
      topics: ["stacks"],
    });
  });

  it("pushes a topic when a watched view's signature changes", async () => {
    let found = "a";
    setTopicSignature("discovered-test", () => found);
    const seen = stream();
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen.some((m) => m.type === "changed")).toBe(false);
    found = "b";
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen.find((m) => m.type === "changed")).toMatchObject({
      topics: ["discovered-test"],
    });
  });

  it("tells both kinds of subscriber about a renamed session", async () => {
    const plain = subscribe();
    const numbered = stream();
    await vi.advanceTimersByTimeAsync(60);
    notifySessionsChanged();
    await vi.advanceTimersByTimeAsync(60);
    expect(plain.at(-1)).toBe(JSON.stringify({ type: "sessions" }));
    expect(numbered.at(-1)).toMatchObject({
      type: "changed",
      topics: ["sessions"],
    });
  });

  it("calls the run-finished hook when a running session stops", async () => {
    const finished: string[] = [];
    setRunFinished((id) => finished.push(id));
    stream();
    version = 1;
    await vi.advanceTimersByTimeAsync(60);
    expect(finished).toEqual([]);
    version = 2;
    notifyStatusChanged();
    await vi.advanceTimersByTimeAsync(60);
    expect(finished).toEqual(["s"]);
  });

  it("keeps going when the table changes can't be read once", async () => {
    let fail = true;
    let moved: string[] = [];
    setStatusSource(
      collector,
      async () => terminals,
      () => {
        if (fail) {
          fail = false;
          throw new Error("database is locked");
        }
        return moved.splice(0);
      }
    );
    let sig = "a";
    setTopicSignature("still-checked", () => sig);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen = stream();
    await vi.advanceTimersByTimeAsync(60);
    sig = "b";
    moved = ["schedules"];
    await vi.advanceTimersByTimeAsync(2100);
    const topics = seen
      .filter((m) => m.type === "changed")
      .flatMap((m) => m.topics as string[]);
    expect(topics).toContain("still-checked");
    expect(topics).toContain("schedules");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
