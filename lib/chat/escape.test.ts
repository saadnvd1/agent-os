import { describe, expect, it } from "vitest";
import { escapeInterrupts, type EscapeKey } from "./escape";

const key = (over: Partial<EscapeKey> = {}): EscapeKey => ({
  key: "Escape",
  repeat: false,
  isComposing: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("escapeInterrupts", () => {
  it("stops a running turn", () => {
    expect(escapeInterrupts(key(), true, false)).toBe(true);
  });

  it("does nothing when no turn runs", () => {
    expect(escapeInterrupts(key(), false, false)).toBe(false);
  });

  it("leaves Esc to an open menu, dialog or lightbox", () => {
    expect(escapeInterrupts(key(), true, true)).toBe(false);
  });

  it("ignores other keys, held keys, IME and modified Esc", () => {
    for (const over of [
      { key: "Enter" },
      { repeat: true },
      { isComposing: true },
      { metaKey: true },
      { shiftKey: true },
    ])
      expect(escapeInterrupts(key(over), true, false)).toBe(false);
  });
});
