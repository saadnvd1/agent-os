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

  it("trusts a saved midTurn over the guess, so a cut-off turn can't swallow later events", () => {
    const sent = (id: string, midTurn: boolean) => event(id, { midTurn });
    const items = [
      user("u", { midTurn: false }),
      a("a1"),
      sent("R", false),
      a("r1"),
      end("end1"),
      sent("E2", false),
      a("r2"),
      end("end2"),
      sent("E3", false),
      a("r3"),
      end("end3"),
    ];
    expect(readingOrder(items)).toBe(items);
  });

  it("holds an event saved as mid-turn until the turn ends, however it looks", () => {
    const items = [
      user("u", { midTurn: false }),
      event("e", { midTurn: true }),
      a("b"),
      end("t"),
      a("c"),
      end("t2"),
    ];
    expect(ids(readingOrder(items))).toEqual(["u", "b", "t", "e", "c", "t2"]);
  });

  it("starts one waiting event per turn end, so answers stay with their own", () => {
    const items = [
      user("u", { midTurn: false }),
      event("e1", { midTurn: true }),
      event("e2", { midTurn: true }),
      a("b"),
      end("t1"),
      a("r1"),
      end("t2"),
      a("r2"),
      end("t3"),
    ];
    expect(ids(readingOrder(items))).toEqual([
      "u",
      "b",
      "t1",
      "e1",
      "r1",
      "t2",
      "e2",
      "r2",
      "t3",
    ]);
  });

  it("answered together, the first takes the reply and the rest stay bare", () => {
    const items = [
      user("u", { midTurn: false }),
      event("e1", { midTurn: true }),
      event("e2", { midTurn: true }),
      a("b"),
      end("t1"),
      a("both"),
      end("t2"),
      user("typed", { midTurn: false }),
    ];
    expect(ids(readingOrder(items))).toEqual([
      "u",
      "b",
      "t1",
      "e1",
      "both",
      "t2",
      "e2",
      "typed",
    ]);
  });

  it("an extra turn end doesn't move an event's reply", () => {
    const items = [
      user("u", { midTurn: false }),
      event("e1", { midTurn: true }),
      a("b"),
      end("t1"),
      a("r1"),
      end("t2"),
      end("stray"),
      user("typed", { midTurn: false }),
    ];
    expect(ids(readingOrder(items))).toEqual([
      "u",
      "b",
      "t1",
      "e1",
      "r1",
      "t2",
      "stray",
      "typed",
    ]);
  });
});
