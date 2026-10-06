import { describe, expect, it } from "vitest";
import { enterAction, FENCE_LINE, type EnterState } from "./enter";

const base: EnterState = {
  shift: false,
  composing: false,
  coarse: false,
  menuOpen: false,
  fenceLine: false,
};
const act = (s: Partial<EnterState>) => enterAction({ ...base, ...s });

describe("enterAction", () => {
  it("sends on a keyboard", () => expect(act({})).toBe("send"));
  it("is a newline with Shift everywhere", () => {
    expect(act({ shift: true })).toBe("newline");
    expect(act({ shift: true, coarse: true })).toBe("newline");
  });
  it("is a newline on touch screens", () =>
    expect(act({ coarse: true })).toBe("newline"));
  it("never acts mid composition", () => {
    expect(act({ composing: true })).toBe("ignore");
    expect(act({ composing: true, menuOpen: true })).toBe("ignore");
  });
  it("picks from an open command menu", () => {
    expect(act({ menuOpen: true })).toBe("pick");
    expect(act({ menuOpen: true, coarse: true })).toBe("pick");
    expect(act({ menuOpen: true, shift: true })).toBe("newline");
  });
  it("opens a code block after a fence instead of sending", () => {
    expect(act({ fenceLine: true })).toBe("fence");
    expect(act({ fenceLine: true, coarse: true })).toBe("fence");
  });
  it("knows a fence line", () => {
    expect(FENCE_LINE.exec("```ts")?.[2]).toBe("ts");
    expect(FENCE_LINE.test("```")).toBe(true);
    expect(FENCE_LINE.test("```ts x")).toBe(false);
    expect(FENCE_LINE.test("say ```")).toBe(false);
  });
});
