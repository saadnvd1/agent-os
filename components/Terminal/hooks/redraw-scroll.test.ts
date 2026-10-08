import { describe, expect, it } from "vitest";
import { scrollAfterRedraw } from "./websocket-connection";

describe("scrolling after a redraw", () => {
  it("puts a reader scrolled up back as far from the bottom", () => {
    // 30 lines up from the bottom before; the redraw's buffer ends at 500.
    expect(scrollAfterRedraw(false, 30, 500)).toBe(470);
  });

  it("never goes above the top", () => {
    expect(scrollAfterRedraw(false, 800, 500)).toBe(0);
  });

  it("leaves a reader at the bottom following the output", () => {
    expect(scrollAfterRedraw(true, 0, 500)).toBeNull();
  });
});
