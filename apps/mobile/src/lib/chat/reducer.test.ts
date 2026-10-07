import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { applyChatMessage, EMPTY_CHAT, runningTurn } from "./reducer";

const user = (id: string): ChatItem => ({
  id,
  createdAt: 1,
  kind: "user",
  text: "hi",
});
const reply = (id: string, text = ""): ChatItem => ({
  id,
  createdAt: 2,
  kind: "assistant",
  text,
  streaming: true,
});

const snap = applyChatMessage(EMPTY_CHAT, {
  type: "snapshot",
  items: [user("u1")],
  state: "running",
  queue: [],
  suggestion: "next?",
});

describe("applyChatMessage", () => {
  it("replaces everything on a snapshot", () => {
    expect(snap).toMatchObject({
      loaded: true,
      state: "running",
      suggestion: "next?",
    });
    expect(snap.items).toHaveLength(1);
  });

  it("appends a new item and replaces one it already has", () => {
    const added = applyChatMessage(snap, {
      type: "item",
      item: reply("a1", "x"),
    });
    expect(added.items.map((i) => i.id)).toEqual(["u1", "a1"]);
    const replaced = applyChatMessage(added, {
      type: "item",
      item: reply("a1", "done"),
    });
    expect(replaced.items).toHaveLength(2);
    expect(replaced.items[1]).toMatchObject({ text: "done" });
  });

  it("streams deltas onto the item's text and ignores unknown ids", () => {
    let v = applyChatMessage(snap, { type: "item", item: reply("a1") });
    v = applyChatMessage(v, { type: "delta", id: "a1", text: "Hel" });
    v = applyChatMessage(v, { type: "delta", id: "a1", text: "lo" });
    expect(v.items[1]).toMatchObject({ text: "Hello" });
    expect(applyChatMessage(v, { type: "delta", id: "nope", text: "x" })).toBe(
      v
    );
  });

  it("tracks state, queue and the suggestion", () => {
    const q = [{ id: "q1", text: "later", createdAt: 3 }];
    let v = applyChatMessage(snap, { type: "queue", queue: q });
    v = applyChatMessage(v, { type: "state", state: "idle" });
    v = applyChatMessage(v, { type: "suggestion", text: null });
    expect(v).toMatchObject({ queue: q, state: "idle", suggestion: null });
  });
});

describe("runningTurn", () => {
  it("is the last user message while a turn runs, and nothing when idle", () => {
    const v = applyChatMessage(snap, { type: "item", item: user("u2") });
    expect(runningTurn(v)).toBe("u2");
    expect(runningTurn({ ...v, state: "idle" })).toBeUndefined();
  });
});

describe("capabilities", () => {
  const caps = {
    type: "capabilities" as const,
    commands: [{ name: "review", description: "Review the branch" }],
    models: [{ value: "opus", label: "Opus" }],
    model: "opus",
    access: "ask" as const,
    plan: false,
  };

  it("keeps what the composer offers, and a later snapshot doesn't drop it", () => {
    const v = applyChatMessage(snap, caps);
    expect(v.caps).toEqual({
      commands: caps.commands,
      models: caps.models,
      model: "opus",
      access: "ask",
      plan: false,
    });
    const again = applyChatMessage(v, {
      type: "snapshot",
      items: [],
      state: "idle",
      queue: [],
      suggestion: null,
    });
    expect(again.caps?.model).toBe("opus");
  });
});
