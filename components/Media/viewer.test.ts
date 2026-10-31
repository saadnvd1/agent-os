import { describe, expect, it } from "vitest";
import { isCloseSwipe, pickSrc } from "./viewer";

describe("pickSrc", () => {
  const media = { src: "/a.png", srcDark: "/a-dark.png" };
  it("uses the dark image in a dark theme", () => {
    expect(pickSrc(media, true)).toBe("/a-dark.png");
  });
  it("uses the light image otherwise", () => {
    expect(pickSrc(media, false)).toBe("/a.png");
  });
  it("falls back when there is no dark variant", () => {
    expect(pickSrc({ src: "/a.png" }, true)).toBe("/a.png");
  });
});

describe("isCloseSwipe", () => {
  it("closes on a long downward drag", () => {
    expect(isCloseSwipe(5, 120)).toBe(true);
  });
  it("ignores short drags, upward drags and sideways drags", () => {
    expect(isCloseSwipe(0, 30)).toBe(false);
    expect(isCloseSwipe(0, -200)).toBe(false);
    expect(isCloseSwipe(150, 90)).toBe(false);
  });
});
