import { describe, expect, it } from "vitest";
import { SEQUENCE_MS, SequenceMatcher } from "./sequence";

const make = (t = { v: 0 }) => ({
  t,
  m: new SequenceMatcher(
    { "g i": "go.inbox", "g p": "chat.previous" },
    () => t.v
  ),
});

describe("SequenceMatcher", () => {
  it("matches a second key after the first", () => {
    const { m } = make();
    expect(m.feed("g")).toEqual({ kind: "pending", first: "g" });
    expect(m.feed("i")).toEqual({ kind: "match", id: "go.inbox" });
  });
  it("ignores the case of the keys", () => {
    const { m } = make();
    m.feed("G");
    expect(m.feed("P")).toEqual({ kind: "match", id: "chat.previous" });
  });
  it("lets a stray second key go and forgets the first", () => {
    const { m } = make();
    m.feed("g");
    expect(m.feed("x")).toEqual({ kind: "none" });
    expect(m.feed("i")).toEqual({ kind: "none" });
  });
  it("lets the second key start a new sequence", () => {
    const { m } = make();
    m.feed("g");
    expect(m.feed("g")).toEqual({ kind: "pending", first: "g" });
    expect(m.feed("i").kind).toBe("match");
  });
  it("gives up when the second key is late", () => {
    const { m, t } = make();
    m.feed("g");
    t.v = SEQUENCE_MS + 1;
    expect(m.pending()).toBeNull();
    expect(m.feed("i")).toEqual({ kind: "none" });
  });
  it("does not match a second key that was never started", () => {
    const { m } = make();
    expect(m.feed("i")).toEqual({ kind: "none" });
  });
});
