import { describe, expect, it } from "vitest";
import { controlModeSupported } from "./start";

describe("controlModeSupported", () => {
  it("takes tmux 3.2 and newer", () => {
    for (const v of [
      "tmux 3.2",
      "tmux 3.2a",
      "tmux 3.4",
      "tmux 3.6a",
      "tmux next-3.5",
      "tmux 4.0",
    ])
      expect(controlModeSupported(v), v).toBe(true);
  });

  it("refuses older tmux and anything it can't read", () => {
    for (const v of ["tmux 3.1c", "tmux 2.9", "garbage", ""])
      expect(controlModeSupported(v), v).toBe(false);
  });
});
