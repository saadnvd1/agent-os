import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { ModelWaitTracker } from "./model-wait";
import type { WorkerEvent } from "./worker/protocol";

const tool = (id: string, status: "running" | "done"): WorkerEvent => ({
  type: "item",
  item: {
    id,
    kind: "tool",
    name: "Bash",
    title: "x",
    input: {},
    status,
    createdAt: 1,
  } as ChatItem,
});
const run: WorkerEvent = { type: "state", state: "running" };

describe("ModelWaitTracker", () => {
  it("waits from the start of a turn until a tool runs", () => {
    const t = new ModelWaitTracker();
    expect(t.on(run, 10)).toBe(true);
    expect(t.wait).toEqual({ since: 10 });
    expect(t.on(tool("a", "running"), 20)).toBe(true);
    expect(t.wait).toBeNull();
  });

  it("waits again, from a new time, once the tool is done", () => {
    const t = new ModelWaitTracker();
    t.on(run, 10);
    t.on(tool("a", "running"), 20);
    t.on(tool("a", "done"), 30);
    expect(t.wait).toEqual({ since: 30 });
  });

  it("stays clear while another tool still runs", () => {
    const t = new ModelWaitTracker();
    t.on(run, 10);
    t.on(tool("a", "running"), 20);
    t.on(tool("b", "running"), 21);
    t.on(tool("a", "done"), 30);
    expect(t.wait).toBeNull();
  });

  it("carries only a measured prompt size, and drops it on compaction", () => {
    const t = new ModelWaitTracker();
    t.on(run, 10);
    expect(t.wait?.promptTokens).toBeUndefined();
    t.on({ type: "prompt_tokens", tokens: 5000 }, 11);
    t.on(tool("a", "running"), 20);
    t.on(tool("a", "done"), 30);
    expect(t.wait).toEqual({ since: 30, promptTokens: 5000 });
    t.on({ type: "compacting", compacting: { since: 31 } }, 31);
    expect(t.wait).toBeNull();
    t.on({ type: "compacting", compacting: null }, 40);
    expect(t.wait).toEqual({ since: 40 });
  });

  it("marks a retry without restarting the wait", () => {
    const t = new ModelWaitTracker();
    t.on(run, 10);
    t.on({ type: "model_retry", attempt: 2 }, 50);
    expect(t.wait).toMatchObject({ since: 10, retry: { attempt: 2 } });
  });

  it("clears on a delta and at the end of the turn, and reports no-ops", () => {
    const t = new ModelWaitTracker();
    t.on(run, 10);
    expect(t.on({ type: "delta", id: "x", text: "a" }, 11)).toBe(true);
    expect(t.on({ type: "delta", id: "x", text: "b" }, 12)).toBe(false);
    t.on(tool("a", "done"), 13);
    expect(t.wait).not.toBeNull();
    t.on({ type: "state", state: "idle" }, 14);
    expect(t.wait).toBeNull();
  });
});
