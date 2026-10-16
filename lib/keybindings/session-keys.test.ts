import { describe, expect, it, vi } from "vitest";
import { chordHint } from "./chord";
import { fieldOwnsKey } from "./focus";
import { KeybindingRegistry } from "./registry";
import { neighbourSession } from "@/lib/sidebar/visible-order";

// The few members fieldOwnsKey reads, without a DOM.
const el = (o: {
  tag?: string;
  value?: string;
  type?: string;
  text?: string;
  editable?: boolean;
  in?: string[];
}) =>
  ({
    tagName: o.tag ?? "DIV",
    value: o.value ?? "",
    type: o.type ?? "text",
    textContent: o.text ?? "",
    isContentEditable: !!o.editable,
    closest: (sel: string) =>
      (o.in ?? []).includes(sel) ? ({} as Element) : null,
  }) as unknown as Element;

const ev = (target: Element, o: Partial<KeyboardEvent> = {}) =>
  ({
    key: "ArrowDown",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    target,
    preventDefault: vi.fn(),
    ...o,
  }) as unknown as KeyboardEvent;

function wire(active: string) {
  const ids = ["a", "b", "c"];
  const selected: string[] = [];
  const reg = new KeybindingRegistry({
    addEventListener() {},
    removeEventListener() {},
  });
  const free = (e: KeyboardEvent) => !fieldOwnsKey(e.target);
  const step = (by: 1 | -1) => {
    const id = neighbourSession(ids, active, by);
    if (id) selected.push(id);
  };
  reg.register("t", [
    { id: "prev", keys: "meta+up", when: free, run: () => step(-1) },
    { id: "next", keys: "meta+down", when: free, run: () => step(1) },
  ]);
  return { reg, selected };
}

describe("session switching keys", () => {
  it("ignores a textarea with text and fires in an empty one", () => {
    const { reg, selected } = wire("b");
    expect(reg.handle(ev(el({ tag: "TEXTAREA", value: "hello" })))).toBe(false);
    expect(reg.handle(ev(el({ tag: "TEXTAREA" })))).toBe(true);
    expect(selected).toEqual(["c"]);
  });

  it("handles inputs, contenteditable, dialogs and the terminal", () => {
    expect(fieldOwnsKey(el({ tag: "INPUT", value: "x" }))).toBe(true);
    expect(fieldOwnsKey(el({ tag: "INPUT" }))).toBe(false);
    expect(
      fieldOwnsKey(el({ tag: "INPUT", type: "checkbox", value: "on" }))
    ).toBe(false);
    expect(fieldOwnsKey(el({ editable: true, text: "typed" }))).toBe(true);
    expect(fieldOwnsKey(el({ editable: true, text: "" }))).toBe(false);
    expect(
      fieldOwnsKey(el({ tag: "TEXTAREA", value: "x", in: [".xterm"] }))
    ).toBe(false);
    expect(fieldOwnsKey(el({ tag: "INPUT", in: ['[role="dialog"]'] }))).toBe(
      true
    );
  });

  it("does not wrap at either end", () => {
    const body = el({});
    const top = wire("a");
    expect(top.reg.handle(ev(body, { key: "ArrowUp" }))).toBe(true);
    expect(top.selected).toEqual([]);
    const bottom = wire("c");
    bottom.reg.handle(ev(body));
    expect(bottom.selected).toEqual([]);
  });
});

describe("mod chord", () => {
  it("is Cmd on a Mac and Ctrl elsewhere, with a matching hint", () => {
    expect(chordHint("mod+up", true)).toBe("⌘↑");
    expect(chordHint("mod+down", false)).toBe("Ctrl+↓");
  });
});
