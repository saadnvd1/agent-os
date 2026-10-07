import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { historyStep, sentPrompts, type HistoryState } from "./history";

const user = (id: string, text: string, extra = {}): ChatItem => ({
  id,
  kind: "user",
  text,
  createdAt: 1,
  ...extra,
});

describe("sentPrompts", () => {
  it("lists the reader's messages newest first, without peers or repeats", () => {
    const items: ChatItem[] = [
      user("1", "first"),
      { id: "a", kind: "assistant", text: "ok", createdAt: 1 },
      user("2", "hi", { peer: { sessionId: "s", body: "hi" }, from: "s" }),
      user("3", "second"),
      user("4", "second"),
      user("5", "  "),
    ];
    expect(sentPrompts(items)).toEqual(["second", "first"]);
  });
});

const at = (over: Partial<HistoryState>): HistoryState => ({
  history: ["newest", "older", "oldest"],
  index: -1,
  text: "",
  firstLine: true,
  lastLine: true,
  ...over,
});

describe("historyStep", () => {
  it("walks back from an empty composer, newest first", () => {
    expect(historyStep(at({}), "up")).toEqual({ index: 0, text: "newest" });
    expect(historyStep(at({ index: 0, text: "newest" }), "up")).toEqual({
      index: 1,
      text: "older",
    });
  });

  it("stops at the oldest", () => {
    expect(historyStep(at({ index: 2, text: "oldest" }), "up")).toBeNull();
  });

  it("walks forward, then back to empty", () => {
    expect(historyStep(at({ index: 1, text: "older" }), "down")).toEqual({
      index: 0,
      text: "newest",
    });
    expect(historyStep(at({ index: 0, text: "newest" }), "down")).toEqual({
      index: -1,
      text: "",
    });
  });

  it("leaves ↓ alone when not walking the history", () => {
    expect(historyStep(at({}), "down")).toBeNull();
  });

  it("leaves a draft alone", () => {
    expect(historyStep(at({ text: "my draft" }), "up")).toBeNull();
    // A recalled message, edited, is a draft too.
    expect(historyStep(at({ index: 0, text: "newest!" }), "up")).toBeNull();
  });

  it("only takes ↑ on the first line and ↓ on the last", () => {
    const multi = at({ history: ["a\nb"], index: 0, text: "a\nb" });
    expect(historyStep({ ...multi, firstLine: false }, "up")).toBeNull();
    expect(historyStep({ ...multi, lastLine: false }, "down")).toBeNull();
    expect(historyStep({ ...multi, firstLine: true }, "down")).toEqual({
      index: -1,
      text: "",
    });
  });

  it("does nothing with no history", () => {
    expect(historyStep(at({ history: [] }), "up")).toBeNull();
  });
});
