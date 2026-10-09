import { describe, expect, it } from "vitest";
import { MouseModes } from "./mouse-modes";

describe("MouseModes", () => {
  it("restores what tmux turned on: tracking and SGR encoding", () => {
    const m = new MouseModes();
    m.feed("\x1b[?1000h\x1b[?1006hhello");
    expect(m.restore()).toBe("\x1b[?1000h\x1b[?1006h");
  });

  it("reads combined parameters and turns modes off again", () => {
    const m = new MouseModes();
    m.feed("\x1b[?1002;1006h");
    expect(m.restore()).toBe("\x1b[?1002h\x1b[?1006h");
    m.feed("\x1b[?1002l\x1b[?1006l");
    expect(m.restore()).toBe("");
  });

  it("catches a sequence split across two chunks", () => {
    const m = new MouseModes();
    m.feed("text\x1b[?10");
    m.feed("00h more");
    expect(m.restore()).toBe("\x1b[?1000h");
  });

  it("ignores other private modes", () => {
    const m = new MouseModes();
    m.feed("\x1b[?1049h\x1b[?25l\x1b[?2004h");
    expect(m.restore()).toBe("");
  });
});
