import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem, DriverEvent } from "../events";
import { OpenCodeMapper } from "./opencode-mapper";

const SID = "s1";

function drive() {
  const out: DriverEvent[] = [];
  const mapper = new OpenCodeMapper(
    () => SID,
    (e) => out.push(e)
  );
  const send = (type: string, properties: Record<string, unknown> = {}) =>
    mapper.map({ type, properties: { sessionID: SID, ...properties } });
  const status = (type: string) => send("session.status", { status: { type } });
  const message = (info: Record<string, unknown>) =>
    send("message.updated", { info });
  const part = (p: Record<string, unknown>) =>
    send("message.part.updated", { part: p });
  // One completed assistant reply: text, or a tool call when `tool` is set.
  const reply = (id: string, text: string, finish = "stop", tool = false) => {
    message({ id, role: "assistant" });
    if (text)
      part({
        id: `${id}-t`,
        messageID: id,
        type: "text",
        text,
        time: { end: 1 },
      });
    if (tool)
      part({
        id: `${id}-c`,
        messageID: id,
        type: "tool",
        tool: "bash",
        state: { status: "completed", input: { command: "ls" }, output: "x" },
      });
    message({ id, role: "assistant", finish, time: { completed: 1 } });
  };
  const compaction = (summary: string) => {
    part({ id: "cp", messageID: "u2", type: "compaction" });
    message({
      id: "sum",
      role: "assistant",
      mode: "compaction",
      summary: true,
    });
    if (summary)
      part({ id: "sum-t", messageID: "sum", type: "text", text: summary });
    message({
      id: "sum",
      role: "assistant",
      mode: "compaction",
      summary: true,
      finish: "stop",
      time: { completed: 1 },
    });
    send("session.compacted");
  };
  // Each item once, as last updated.
  const items = (): ChatItem[] => [
    ...new Map(
      out.flatMap((e) =>
        e.type === "item" ? [[e.item.id, e.item] as const] : []
      )
    ).values(),
  ];
  const end = () => items().findLast((i) => i.kind === "turn_end");
  const compacting = () =>
    out.flatMap((e) => (e.type === "compacting" ? [e.active] : []));
  return {
    mapper,
    out,
    send,
    status,
    reply,
    compaction,
    items,
    end,
    compacting,
    message,
    part,
  };
}

describe("OpenCode compaction", () => {
  it("shows compacting while the summary is made, and not after", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.reply("a1", "working", "tool-calls", true);
    d.part({ id: "cp", messageID: "u2", type: "compaction" });
    expect(d.compacting()).toEqual([true]);
    d.compaction("## Summary");
    expect(d.compacting()).toEqual([true, false]);
    d.reply("a2", "All done.");
    d.status("idle");
    expect(d.end()).toMatchObject({ kind: "turn_end" });
    expect((d.end() as { ended?: unknown }).ended).toBeUndefined();
  });

  it("keeps the summary out of the chat", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.compaction("## Summary of the work");
    d.reply("a2", "Carrying on.");
    d.status("idle");
    const texts = d
      .items()
      .flatMap((i) => (i.kind === "assistant" ? [i.text] : []));
    expect(texts).toEqual(["Carrying on."]);
    expect(d.items().some((i) => i.kind === "compacted")).toBe(true);
  });

  it("says so when nothing comes back after the compaction", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.compaction("");
    d.status("idle");
    expect(d.end()).toMatchObject({ ended: { reason: "compaction_empty" } });
  });

  it("says so when the model replies empty after a summary", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.compaction("## Summary");
    d.reply("a2", "");
    d.status("idle");
    expect(d.end()).toMatchObject({ ended: { reason: "compaction_empty" } });
  });

  it("stops compacting when the summary fails", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.part({ id: "cp", messageID: "u2", type: "compaction" });
    d.send("session.error", {
      error: { name: "APIError", data: { message: "bad" } },
    });
    expect(d.compacting().at(-1)).toBe(false);
  });
});

describe("a turn that ends with nothing to show", () => {
  it("is flagged when it goes idle right after a tool step", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.reply("a1", "Let me create autofill.ts:", "tool-calls", true);
    d.status("idle");
    // The nudge asks for a summary once; the turn then ends.
    expect(d.mapper.takeNudge()).toBe(false);
    expect(d.end()).toMatchObject({ ended: { reason: "cut_off" } });
  });

  it("is not flagged when the model answered after its tools", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.reply("a1", "", "tool-calls", true);
    d.reply("a2", "Fixed it. Tests pass.");
    d.status("idle");
    expect((d.end() as { ended?: unknown }).ended).toBeUndefined();
  });

  it("is flagged when no assistant message came at all", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.status("idle");
    expect(d.end()).toMatchObject({ ended: { reason: "empty" } });
  });
});

describe("a stalled request", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("counts silence only while waiting on the model", () => {
    const d = drive();
    expect(d.mapper.silentMs()).toBe(0);
    d.mapper.prompted();
    d.status("busy");
    vi.advanceTimersByTime(60_000);
    expect(d.mapper.silentMs()).toBe(60_000);
    d.message({ id: "m", role: "assistant" });
    d.part({
      id: "c",
      messageID: "m",
      type: "tool",
      tool: "bash",
      state: { status: "running" },
    });
    vi.advanceTimersByTime(600_000);
    expect(d.mapper.silentMs()).toBe(0);
  });

  it("is not reset by OpenCode's retry notices", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    vi.advanceTimersByTime(30_000);
    d.status("retry");
    vi.advanceTimersByTime(30_000);
    expect(d.mapper.silentMs()).toBe(60_000);
    d.send("message.updated", { info: { id: "m", role: "assistant" } });
    expect(d.mapper.silentMs()).toBe(0);
  });

  it("ends the turn with a stalled notice, naming a compaction", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.part({ id: "cp", messageID: "u2", type: "compaction" });
    d.mapper.stalled(22 * 60_000);
    expect(d.compacting()).toEqual([true, false]);
    const ended = (d.end() as { ended?: { reason: string; notice: string } })
      .ended;
    expect(ended?.reason).toBe("stalled");
    expect(ended?.notice).toContain("compacting");
    expect(ended?.notice).toContain("22 minutes");
    expect(d.out.at(-1)).toEqual({ type: "state", state: "idle" });
    expect(d.mapper.items.inTurn).toBe(false);
  });

  it("says model request stalled outside a compaction", () => {
    const d = drive();
    d.mapper.prompted();
    d.status("busy");
    d.mapper.stalled(22 * 60_000);
    expect(JSON.stringify(d.end())).toContain("Model request stalled");
  });
});
