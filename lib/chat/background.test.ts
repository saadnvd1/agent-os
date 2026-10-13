import { describe, expect, it } from "vitest";
import {
  backgroundable,
  backgroundFailure,
  backgroundKey,
  outputTail,
} from "./background";

const tool = { status: "running" as const, createdAt: 1000 };
const fg = { status: "running" as const, backgrounded: false };

describe("backgroundable", () => {
  it("is offered for a running call that blocks the turn, after a few seconds", () => {
    expect(backgroundable(true, tool, fg, 4000)).toBe(true);
  });

  it("is not offered before the delay, so quick commands never flash it", () => {
    expect(backgroundable(true, tool, fg, 3999)).toBe(false);
  });

  it("is not offered when the agent can't, there is no task yet, or it already moved", () => {
    expect(backgroundable(false, tool, fg, 9000)).toBe(false);
    expect(backgroundable(true, tool, undefined, 9000)).toBe(false);
    expect(
      backgroundable(
        true,
        tool,
        { status: "running", backgrounded: true },
        9000
      )
    ).toBe(false);
    expect(backgroundable(true, tool, { status: "running" }, 9000)).toBe(false);
  });

  it("is not offered once the call or its task has finished", () => {
    expect(backgroundable(true, { ...tool, status: "done" }, fg, 9000)).toBe(
      false
    );
    expect(
      backgroundable(
        true,
        tool,
        { status: "completed", backgrounded: false },
        9000
      )
    ).toBe(false);
  });
});

describe("backgroundKey", () => {
  const key = (o: object = {}) => ({
    key: "b",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...o,
  });

  it("takes Ctrl+B only while something can move", () => {
    expect(backgroundKey(key(), true)).toBe(true);
    expect(backgroundKey(key(), false)).toBe(false);
  });

  it("leaves every other combination alone", () => {
    expect(backgroundKey(key({ ctrlKey: false }), true)).toBe(false);
    expect(backgroundKey(key({ metaKey: true }), true)).toBe(false);
    expect(backgroundKey(key({ shiftKey: true }), true)).toBe(false);
    expect(backgroundKey(key({ key: "c" }), true)).toBe(false);
    expect(backgroundKey(key({ repeat: true }), true)).toBe(false);
  });
});

describe("backgroundFailure", () => {
  it("says nothing when it worked", () => {
    expect(backgroundFailure({ ok: true }, tool, fg)).toBeNull();
  });

  it("says why when nothing moved", () => {
    expect(
      backgroundFailure({ ok: false }, { status: "done" }, undefined)
    ).toBe("That step already finished");
    expect(backgroundFailure({ ok: false }, tool, { backgrounded: true })).toBe(
      "Already running in the background"
    );
    expect(backgroundFailure({ ok: false }, tool, fg)).toMatch(/yet/);
  });

  it("tells a request that never arrived from a refusal", () => {
    for (const error of ["timeout", "unavailable", "unsupported"])
      expect(backgroundFailure({ ok: false, error }, tool, fg)).toMatch(
        /reach the agent/
      );
    expect(
      backgroundFailure({ ok: false, error: "disabled" }, tool, fg)
    ).toMatch(/turned off/);
  });
});

describe("outputTail", () => {
  it("is the last line with anything on it", () => {
    expect(outputTail("a\nb  \n\n  \n")).toBe("b");
    expect(outputTail("")).toBeNull();
    expect(outputTail(null)).toBeNull();
  });
});
