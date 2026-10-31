import { describe, expect, it } from "vitest";
import { previousChatId, recentFirst } from "./recent";

const views = { a: 10, b: 30, c: 20 };

describe("recentFirst", () => {
  it("orders by last opened, never-opened last in their own order", () => {
    const items = [{ id: "x" }, { id: "a" }, { id: "y" }, { id: "b" }];
    expect(recentFirst(items, views).map((i) => i.id)).toEqual([
      "b",
      "a",
      "x",
      "y",
    ]);
  });
});

describe("previousChatId", () => {
  it("is the most recent chat that is not the current one", () => {
    expect(previousChatId(["a", "b", "c"], views, "b")).toBe("c");
  });
  it("flips back and forth once the new chat is stamped", () => {
    const after = { ...views, c: 40 };
    expect(previousChatId(["a", "b", "c"], after, "c")).toBe("b");
  });
  it("skips chats that are gone and never-opened ones", () => {
    expect(previousChatId(["a", "z"], views, "b")).toBe("a");
    expect(previousChatId(["z"], views, "b")).toBeNull();
  });
  it("is null with nothing else opened", () => {
    expect(previousChatId(["b"], views, "b")).toBeNull();
  });
});
