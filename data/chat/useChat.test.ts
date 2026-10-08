import { describe, expect, it } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { applyDeltas, joinPage } from "./useChat";

const say = (id: string, text = ""): ChatItem => ({
  id,
  kind: "assistant",
  text,
  createdAt: 1,
});

describe("applyDeltas", () => {
  it("appends each item's text and keeps every other item's identity", () => {
    const items = [say("a", "x"), say("b", "hel"), say("c", "")];
    const next = applyDeltas(
      items,
      new Map([
        ["b", "lo"],
        ["c", "!"],
      ])
    );
    expect(next.map((i) => ("text" in i ? i.text : ""))).toEqual([
      "x",
      "hello",
      "!",
    ]);
    expect(next[0]).toBe(items[0]);
  });

  it("returns the same array when nothing matched", () => {
    const items = [say("a")];
    expect(applyDeltas(items, new Map([["zz", "x"]]))).toBe(items);
  });
});

describe("joinPage", () => {
  it("keeps older loaded items before a fresh page that overlaps them", () => {
    const prev = ["a", "b", "c", "d"].map((id) => say(id));
    const page = [say("c", "new"), say("e")];
    expect(joinPage(prev, page)?.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "e",
    ]);
  });

  it("takes the page as it is when it doesn't overlap or starts the same", () => {
    expect(joinPage([say("a")], [say("x")])).toBeNull();
    expect(joinPage([say("a"), say("b")], [say("a")])).toBeNull();
    expect(joinPage([say("a")], [])).toBeNull();
  });
});
