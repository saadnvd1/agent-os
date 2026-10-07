import { describe, expect, it } from "vitest";
import { htmlText } from "./html";
import { parseMarkdown } from "./parse";

describe("htmlText", () => {
  it("drops tags and keeps what they wrapped", () => {
    expect(htmlText('<span style="color: red;">Red</span>')).toBe("Red");
    expect(htmlText("<div>\n<b>bold</b><br/>\n</div>")).toBe("\nbold\n");
  });

  it("drops comments and script tags without running anything", () => {
    expect(htmlText("<!-- note -->hi<script>alert(1)</script>")).toBe(
      "hialert(1)"
    );
  });

  it("leaves text that only looks like a comparison", () => {
    expect(htmlText("a < b and c > d")).toBe("a < b and c > d");
  });

  it("empties each inline html node mdast produces, leaving the text between", () => {
    const tree = parseMarkdown('- <span style="color: red;">Red bullet</span>');
    const list = tree.children[0];
    if (list.type !== "list") throw new Error("expected a list");
    const para = list.children[0].children[0];
    if (para.type !== "paragraph") throw new Error("expected a paragraph");
    const shown = para.children
      .map((n) =>
        n.type === "html" ? htmlText(n.value) : n.type === "text" ? n.value : ""
      )
      .join("");
    expect(shown).toBe("Red bullet");
  });
});
