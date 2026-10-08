import { describe, expect, it } from "vitest";
import { LRU } from "./lru";

describe("LRU", () => {
  it("drops the least recently used past its entry count", () => {
    const lru = new LRU<number>(2, 100);
    lru.set("a", 1, 1);
    lru.set("b", 2, 1);
    expect(lru.get("a")).toBe(1); // a is now the most recent
    lru.set("c", 3, 1);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);
    expect(lru.get("c")).toBe(3);
  });

  it("drops entries past its size and never keeps one bigger than it", () => {
    const lru = new LRU<string>(10, 10);
    lru.set("a", "x", 6);
    lru.set("b", "y", 6);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe("y");
    lru.set("huge", "z", 11);
    expect(lru.get("huge")).toBeUndefined();
    expect(lru.count).toBe(1);
  });

  it("replacing a key updates its size", () => {
    const lru = new LRU<string>(10, 10);
    lru.set("a", "x", 8);
    lru.set("a", "y", 2);
    lru.set("b", "z", 8);
    expect(lru.get("a")).toBe("y");
    expect(lru.get("b")).toBe("z");
  });
});
