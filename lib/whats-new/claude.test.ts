import { describe, expect, it } from "vitest";
import { haikuArgs, haikuError } from "./claude";

describe("haikuArgs", () => {
  it("passes no tools without an empty argument", () => {
    const a = haikuArgs("sys");
    expect(a).toContain("--tools=");
    expect(a).not.toContain("");
    expect(a.slice(-2)).toEqual(["--system-prompt", "sys"]);
  });
});

describe("haikuError", () => {
  it("reports the first stderr line, never the command", () => {
    const e = haikuError(
      new Error("Command failed: claude -p --system-prompt SECRET\nmore"),
      "\nAuth expired\nstack",
      ""
    );
    expect(e.message).toBe("claude -p failed: Auth expired");
  });
  it("falls back to stdout, then the message's first line", () => {
    expect(haikuError(new Error("x"), "", "rate limited\n").message).toContain(
      "rate limited"
    );
    expect(haikuError(new Error("boom\nrest"), "", "").message).toContain(
      "boom"
    );
  });
});
