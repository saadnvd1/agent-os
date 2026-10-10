import { describe, expect, it } from "vitest";
import { parseScopeChange } from "./scope-change";

describe("parseScopeChange", () => {
  it("reads a Scope change section up to the next heading of its level", () => {
    const body = [
      "## Summary",
      "Adds the thing.",
      "## Scope change",
      "Saad dropped the Restart menu item.",
      "### Why",
      "It was confusing.",
      "## Code review",
      "Reviewed: abcdef123456",
    ].join("\n");
    expect(parseScopeChange(body)).toBe(
      "Saad dropped the Restart menu item.\n### Why\nIt was confusing."
    );
  });

  it("reads a paragraph that opens with Scope change:, bold or not", () => {
    expect(
      parseScopeChange(
        "Intro.\n\n**Scope change:** no menu item.\nStill automatic.\n\nOther text."
      )
    ).toBe("**Scope change:** no menu item.\nStill automatic.");
    expect(parseScopeChange("Scope changes: none of note")).toBe(
      "Scope changes: none of note"
    );
  });

  it("ignores prose, code and comments that only mention it", () => {
    expect(parseScopeChange(null)).toBeNull();
    expect(parseScopeChange("No scope change here.")).toBeNull();
    expect(
      parseScopeChange(
        "```\n## Scope change\nfake\n```\n<!-- Scope change: x -->"
      )
    ).toBeNull();
  });
});
