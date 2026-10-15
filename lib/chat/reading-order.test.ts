import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { readingOrder } from "./reading-order";

const user = (id: string, over: object = {}): ChatItem => ({
  id,
  kind: "user",
  text: "x",
  tagged: true,
  createdAt: 0,
  ...over,
});
const event = (id: string, over: object = {}) =>
  user(id, { origin: { kind: "event", label: "AgentOS" }, ...over });
const a = (id: string): ChatItem => ({
  id,
  kind: "assistant",
  text: "hi",
  createdAt: 0,
});
const end = (id: string): ChatItem => ({ id, kind: "turn_end", createdAt: 0 });
const ids = (items: ChatItem[]) => items.map((i) => i.id);

describe("readingOrder", () => {
  it("returns a chat with nothing mid-turn untouched", () => {
    const items = [user("u"), a("a"), end("t"), event("e"), a("b"), end("t2")];
    expect(readingOrder(items)).toBe(items);
  });

  it("moves an event sent mid-turn to after the turn's end", () => {
    const items = [user("u"), a("a"), event("e"), a("b"), end("t"), a("c")];
    expect(ids(readingOrder(items))).toEqual(["u", "a", "b", "t", "e", "c"]);
  });

  it("leaves an event after a turn that already ended", () => {
    const items = [user("u"), end("t"), event("e"), a("b")];
    expect(ids(readingOrder(items))).toEqual(["u", "t", "e", "b"]);
  });

  it("puts events still waiting at the end when the turn is running", () => {
    expect(ids(readingOrder([user("u"), event("e"), a("b")]))).toEqual([
      "u",
      "b",
      "e",
    ]);
  });

  it("doesn't carry a turn across an undo or an error", () => {
    const err: ChatItem = {
      id: "er",
      kind: "error",
      message: "m",
      createdAt: 0,
    };
    const items = [user("u"), err, event("e")];
    expect(readingOrder(items)).toBe(items);
  });
});
