import { describe, expect, it } from "vitest";
import { needsMoreHistory } from "./needs-more-history";

const base = {
  hasMore: true,
  loading: false,
  scrollHeight: 300,
  clientHeight: 600,
};

describe("needsMoreHistory", () => {
  it("asks for more when the list is shorter than the screen", () => {
    expect(needsMoreHistory(base)).toBe(true);
  });
  it("asks while less than one extra screen overflows", () => {
    expect(needsMoreHistory({ ...base, scrollHeight: 1200 })).toBe(true);
  });
  it("stops once there is more than a screen of overflow", () => {
    expect(needsMoreHistory({ ...base, scrollHeight: 1201 })).toBe(false);
  });
  it("does nothing without more history or while a page is loading", () => {
    expect(needsMoreHistory({ ...base, hasMore: false })).toBe(false);
    expect(needsMoreHistory({ ...base, loading: true })).toBe(false);
  });
  it("ignores a list that has no size yet", () => {
    expect(needsMoreHistory({ ...base, clientHeight: 0 })).toBe(false);
  });
});
