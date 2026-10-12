import { describe, expect, it } from "vitest";
import {
  MAX_LOADED_BODIES,
  MAX_LOADED_BODY_CHARS,
  addBody,
  needsBody,
  touchBody,
  type Bodies,
} from "./bodyCache";

const none = new Set<string>();
const fill = (n: number): Bodies => {
  let b: Bodies = {};
  for (let i = 0; i < n; i++) b = addBody(b, `t${i}`, { output: "x" }, none);
  return b;
};

describe("body cache", () => {
  it("evicts the oldest past the count cap", () => {
    const b = addBody(fill(MAX_LOADED_BODIES), "new", { output: "x" }, none);
    expect(Object.keys(b)).toHaveLength(MAX_LOADED_BODIES);
    expect(b.t0).toBeUndefined();
    expect(b.t1).toBeDefined();
    expect(b.new).toBeDefined();
  });

  it("evicts by size past the byte cap", () => {
    const half = "x".repeat(MAX_LOADED_BODY_CHARS / 2 + 1);
    let b = addBody({}, "a", { output: half }, none);
    b = addBody(b, "small", { output: "x" }, none);
    b = addBody(b, "c", { output: half }, none);
    expect(Object.keys(b)).toEqual(["small", "c"]);
  });

  it("keeps a visible body however old", () => {
    const b = addBody(
      fill(MAX_LOADED_BODIES),
      "new",
      { output: "x" },
      new Set(["t0"])
    );
    expect(b.t0).toBeDefined();
    expect(b.t1).toBeUndefined();
  });

  it("a touched body outlives older ones", () => {
    const b = addBody(
      touchBody(fill(MAX_LOADED_BODIES), "t0"),
      "new",
      null,
      none
    );
    expect(b.t0).toBeDefined();
    expect(b.t1).toBeUndefined();
  });

  it("an evicted body is fetched again on reopen, a loaded one is not", () => {
    const b = addBody(fill(MAX_LOADED_BODIES), "new", { output: "x" }, none);
    expect(needsBody(true, b.t0, true)).toBe(true);
    expect(needsBody(true, b.t1, true)).toBe(false);
    expect(needsBody(true, b.t0, false)).toBe(false);
  });
});
