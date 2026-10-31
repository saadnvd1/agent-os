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

describe("escapeAction leaving the composer", () => {
  it("leaves the composer only when nothing else takes Esc", () => {
    expect(escapeAction(key(), false, false, false, true)).toBe("blur");
  });

  it("stops a running turn first, and keeps focus", () => {
    expect(escapeAction(key(), true, false, false, true)).toBe("interrupt");
  });

  it("sets a suggestion aside first, and keeps focus", () => {
    expect(escapeAction(key(), false, false, true, true)).toBe("dismiss");
  });

  it("leaves Esc to an open menu", () => {
    expect(escapeAction(key(), false, true, false, true)).toBeNull();
  });

  it("does nothing outside the composer or for a modified Esc", () => {
    expect(escapeAction(key(), false, false, false, false)).toBeNull();
    expect(
      escapeAction(key({ shiftKey: true }), false, false, false, true)
    ).toBeNull();
  });
});
