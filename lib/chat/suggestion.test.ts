import { describe, expect, it } from "vitest";
import {
  acceptsSuggestion,
  offeredSuggestion,
  type AcceptKey,
} from "./suggestion";

const key = (k: string, over: Partial<AcceptKey> = {}): AcceptKey => ({
  key: k,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...over,
});

describe("offeredSuggestion", () => {
  it("offers the guess in an empty composer", () => {
    expect(
      offeredSuggestion({ suggestion: "run it", dismissed: null, text: "" })
    ).toBe("run it");
  });

  it("hides it once anything is typed", () => {
    expect(
      offeredSuggestion({ suggestion: "run it", dismissed: null, text: "r" })
    ).toBeNull();
  });

  it("keeps a guess set aside hidden, but shows the next one", () => {
    expect(
      offeredSuggestion({ suggestion: "run it", dismissed: "run it", text: "" })
    ).toBeNull();
    expect(
      offeredSuggestion({
        suggestion: "ship it",
        dismissed: "run it",
        text: "",
      })
    ).toBe("ship it");
  });

  it("has nothing to offer on the first turn or in plan mode", () => {
    expect(
      offeredSuggestion({ suggestion: null, dismissed: null, text: "" })
    ).toBeNull();
  });
});

describe("acceptsSuggestion", () => {
  it("takes Tab", () => {
    expect(acceptsSuggestion(key("Tab"), true, true)).toBe(true);
  });

  it("takes → only with the caret at the end", () => {
    expect(acceptsSuggestion(key("ArrowRight"), true, true)).toBe(true);
    expect(acceptsSuggestion(key("ArrowRight"), true, false)).toBe(false);
  });

  it("leaves Tab and → alone when nothing is offered", () => {
    expect(acceptsSuggestion(key("Tab"), false, true)).toBe(false);
    expect(acceptsSuggestion(key("ArrowRight"), false, true)).toBe(false);
  });

  it("leaves Shift+Tab and modified arrows alone", () => {
    expect(acceptsSuggestion(key("Tab", { shiftKey: true }), true, true)).toBe(
      false
    );
    expect(
      acceptsSuggestion(key("ArrowRight", { metaKey: true }), true, true)
    ).toBe(false);
  });

  it("ignores other keys", () => {
    expect(acceptsSuggestion(key("Enter"), true, true)).toBe(false);
    expect(acceptsSuggestion(key("a"), true, true)).toBe(false);
  });
});
