import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { itemMapper } from "./frames";
import { onMessage, flush } from "./publisher";
import { Ring } from "./ring";
import { live, type Runtime } from "./runtime";

const key = ["gh", "p_", "e".repeat(36)].join("");
const ctx = { home: "/Users/x", user: "x", secrets: [], hosts: [] };
const sends: { action: string; data: Record<string, unknown> }[] = [];

function runtime(): Runtime {
  return {
    share: { id: "s1", session_id: "sess" } as never,
    guests: new Map(),
    ring: new Ring(),
    ctx,
    map: itemMapper(ctx),
    streaming: new Map(),
    dirty: new Map(),
    flushTimer: null,
    slowUntil: 0,
    notice: null,
    drops: 0,
  };
}

const item = (i: Record<string, unknown>) =>
  ({ createdAt: 1, ...i }) as unknown as ChatItem;

let rt: Runtime;
beforeEach(() => {
  vi.useFakeTimers();
  sends.length = 0;
  rt = runtime();
  live.runtimes.set("s1", rt);
  live.socket = {
    send: (_id: string, action: string, data: Record<string, unknown>) =>
      sends.push({ action, data }),
  } as never;
});
afterEach(() => {
  live.runtimes.clear();
  live.socket = null;
  vi.useRealTimers();
});

describe("publisher", () => {
  it("coalesces a streaming reply to one upsert a second, redacted whole", () => {
    onMessage("sess", {
      type: "item",
      item: item({
        id: "a1",
        kind: "assistant",
        text: "key ",
        streaming: true,
      }),
    });
    for (const piece of [key.slice(0, 15), key.slice(15), " done"])
      onMessage("sess", { type: "delta", id: "a1", text: piece });
    expect(sends).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    const items = sends.filter((s) => s.action === "item");
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain(key.slice(0, 15));
  });

  it("holds back the word still being typed while streaming", () => {
    onMessage("sess", {
      type: "item",
      item: item({
        id: "a1",
        kind: "assistant",
        text: "see ",
        streaming: true,
      }),
    });
    onMessage("sess", { type: "delta", id: "a1", text: "ghp_abc" });
    vi.advanceTimersByTime(1000);
    expect(sends[0].data.text).toBe("see ");
    onMessage("sess", {
      type: "item",
      item: item({ id: "a1", kind: "assistant", text: "see ghp_abc" }),
    });
    expect(sends.at(-1)?.data.text).toBe("see ghp_abc");
  });

  it("sends nothing for reasoning, command output or approvals, and fills the ring", () => {
    for (const i of [
      { id: "r", kind: "reasoning", text: "secret thoughts" },
      { id: "c", kind: "command_output", text: "ls" },
      { id: "ap", kind: "approval", tool: "Bash", input: {} },
    ])
      onMessage("sess", { type: "item", item: item(i) });
    vi.advanceTimersByTime(2000);
    expect(sends).toEqual([]);
    onMessage("sess", {
      type: "item",
      item: item({ id: "u", kind: "user", text: "hi" }),
    });
    expect(rt.ring.list().map((f) => f.id)).toEqual(["u"]);
  });

  it("sends state changes, and idle at the end of a turn", () => {
    onMessage("sess", { type: "state", state: "waiting" });
    onMessage("sess", {
      type: "item",
      item: item({ id: "t", kind: "turn_end" }),
    });
    expect(sends.map((s) => s.data.state)).toEqual(["waiting_on_host", "idle"]);
  });

  it("ignores other sessions and ended shares", () => {
    onMessage("other", { type: "state", state: "running" });
    rt.share = { ...rt.share, ended_at: "now" };
    onMessage("sess", { type: "state", state: "running" });
    flush(rt);
    expect(sends).toEqual([]);
  });
});
