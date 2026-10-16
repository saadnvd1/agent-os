import { describe, expect, it, vi } from "vitest";
import { formatChord, matchChord, parseChord } from "./chord";
import { KeybindingRegistry } from "./registry";

const ev = (o: Partial<KeyboardEvent> = {}) =>
  ({
    key: "b",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    preventDefault: vi.fn(),
    ...o,
  }) as unknown as KeyboardEvent;

describe("matchChord", () => {
  const ctrlB = parseChord("ctrl+b");
  it("matches ctrl+b regardless of key case", () => {
    expect(matchChord(ctrlB, ev({ ctrlKey: true }))).toBe(true);
    expect(matchChord(ctrlB, ev({ ctrlKey: true, key: "B" }))).toBe(true);
  });
  it("does not match cmd+b, bare b, or extra modifiers", () => {
    expect(matchChord(ctrlB, ev({ metaKey: true }))).toBe(false);
    expect(matchChord(ctrlB, ev())).toBe(false);
    expect(matchChord(ctrlB, ev({ ctrlKey: true, shiftKey: true }))).toBe(
      false
    );
    expect(matchChord(ctrlB, ev({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(matchChord(ctrlB, ev({ ctrlKey: true, key: "c" }))).toBe(false);
  });
  it("parses aliases and every modifier", () => {
    expect(parseChord("Cmd+Shift+K")).toEqual({
      key: "k",
      ctrl: false,
      meta: true,
      alt: false,
      shift: true,
    });
    expect(matchChord(parseChord("esc"), ev({ key: "Escape" }))).toBe(true);
    expect(
      matchChord(parseChord("shift+tab"), ev({ key: "Tab", shiftKey: true }))
    ).toBe(true);
    expect(
      matchChord(parseChord("alt+x"), ev({ key: "x", altKey: true }))
    ).toBe(true);
  });
  it("rejects malformed chords", () => {
    expect(() => parseChord("ctrl+")).toThrow();
    expect(() => parseChord("a+b")).toThrow();
  });
  it("formats for display", () => {
    expect(formatChord("ctrl+b")).toBe("Ctrl+B");
    expect(formatChord("shift+tab")).toBe("Shift+Tab");
  });
});

describe("KeybindingRegistry", () => {
  const target = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  it("fires only when `when` holds, and only then stops the key", () => {
    const reg = new KeybindingRegistry(target());
    let on = false;
    const run = vi.fn();
    reg.register("t", [{ id: "x", keys: "ctrl+b", when: () => on, run }]);
    const idle = ev({ ctrlKey: true });
    expect(reg.handle(idle)).toBe(false);
    expect(idle.preventDefault).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    on = true;
    const live = ev({ ctrlKey: true });
    expect(reg.handle(live)).toBe(true);
    expect(live.preventDefault).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores other chords, repeats and IME composition", () => {
    const reg = new KeybindingRegistry(target());
    const run = vi.fn();
    reg.register("t", [{ id: "x", keys: "ctrl+b", run }]);
    expect(reg.handle(ev({ metaKey: true }))).toBe(false);
    expect(reg.handle(ev({ ctrlKey: true, repeat: true }))).toBe(false);
    expect(reg.handle(ev({ ctrlKey: true, isComposing: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("falls through to the next binding when the first doesn't apply", () => {
    const reg = new KeybindingRegistry(target());
    const a = vi.fn();
    const b = vi.fn();
    reg.register("a", [{ id: "a", keys: "ctrl+b", when: () => false, run: a }]);
    reg.register("b", [{ id: "b", keys: "ctrl+b", run: b }]);
    reg.handle(ev({ ctrlKey: true }));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it("attaches one listener and removes it with the last source", () => {
    const t = target();
    const reg = new KeybindingRegistry(t);
    const off1 = reg.register("a", [{ id: "a", keys: "ctrl+a", run() {} }]);
    const off2 = reg.register("b", [{ id: "b", keys: "ctrl+b", run() {} }]);
    expect(t.addEventListener).toHaveBeenCalledTimes(1);
    off1();
    expect(t.removeEventListener).not.toHaveBeenCalled();
    off2();
    expect(t.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
