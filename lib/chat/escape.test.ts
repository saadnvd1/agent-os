import { describe, expect, it } from "vitest";
import { escapeAction, escapeInterrupts, type EscapeKey } from "./escape";

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

describe("escapeAction", () => {
  it("sets the ghost text aside instead of stopping the turn", () => {
    expect(escapeAction(key(), true, false, true)).toBe("dismiss");
    expect(escapeAction(key(), false, false, true)).toBe("dismiss");
  });

  it("still stops the turn when there's no suggestion", () => {
    expect(escapeAction(key(), true, false, false)).toBe("interrupt");
    expect(escapeAction(key(), false, false, false)).toBeNull();
  });

  it("leaves both to a menu or dialog on top", () => {
    expect(escapeAction(key(), true, true, true)).toBeNull();
  });

  it("ignores a modified or repeated Esc", () => {
    expect(escapeAction(key({ shiftKey: true }), true, false, true)).toBeNull();
    expect(escapeAction(key({ repeat: true }), true, false, false)).toBeNull();
  });
});
