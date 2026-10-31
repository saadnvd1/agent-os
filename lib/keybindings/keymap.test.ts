import { describe, expect, it } from "vitest";
import { parseChord } from "./chord";
import { KEYMAP, isSequence, keysOf, searchKeymap } from "./keymap";

describe("KEYMAP", () => {
  it("has each id and each key once", () => {
    const ids = KEYMAP.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = KEYMAP.map((k) => k.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("never binds a key the browser keeps", () => {
    const reserved = new Set(["w", "t", "n", "l", "q", "tab", "`"]);
    for (const k of KEYMAP.filter((k) => !k.browser && !isSequence(k.keys))) {
      if (!k.keys.includes("+")) continue;
      const chord = parseChord(k.keys, true);
      expect(reserved.has(chord.key)).toBe(false);
    }
  });
  it("makes bare keys and sequences single-key shortcuts", () => {
    for (const k of KEYMAP)
      if (isSequence(k.keys) || !k.keys.includes("+"))
        if (!k.browser) expect(k.single).toBe(true);
  });
  it("finds by label, keys and group", () => {
    expect(searchKeymap("inbox").map((k) => k.id)).toEqual(["go.inbox"]);
    expect(searchKeymap("g p").map((k) => k.id)).toContain("chat.previous");
    expect(searchKeymap("browser").length).toBe(2);
    expect(searchKeymap("")).toBe(KEYMAP);
  });
  it("looks a key up, and refuses an unknown id", () => {
    expect(keysOf("switcher.open")).toBe("mod+p");
    expect(() => keysOf("nope")).toThrow();
  });
});
