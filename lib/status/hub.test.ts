import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSnapshot } from "./collect";
import { notifyStatusChanged, setStatusSource, subscribeStatuses } from "./hub";

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
  setStatusSource(collector, async () => terminals);
});

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
