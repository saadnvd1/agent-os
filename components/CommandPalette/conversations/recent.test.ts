import { describe, expect, it } from "vitest";
import { MAX_RECENT, parseRecent, withRecent } from "./recent";

describe("recent searches", () => {
  it("puts the newest first and keeps each search once", () => {
    expect(withRecent(["b", "a"], " a ")).toEqual(["a", "b"]);
    expect(withRecent(["b"], "c")).toEqual(["c", "b"]);
  });
  it("is capped and ignores a blank search", () => {
    const many = Array.from({ length: 20 }, (_, i) => `q${i}`);
    expect(withRecent(many, "new")).toHaveLength(MAX_RECENT);
    expect(withRecent(["a"], "  ")).toEqual(["a"]);
  });
  it("survives what storage may hold", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('["a",3,null,"b"]')).toEqual(["a", "b"]);
  });
});
