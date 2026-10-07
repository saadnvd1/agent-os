import type { PhrasingContent, RootContent } from "mdast";
import { describe, expect, it } from "vitest";
import { htmlBlockText, htmlText } from "./html";
import { parseMarkdown } from "./parse";

// What a paragraph shows, the way Inline.tsx turns its nodes into text.
function shown(markdown: string): string {
  const first = parseMarkdown(markdown).children[0] as RootContent;
  const para = first.type === "list" ? first.children[0].children[0] : first;
  if (para.type !== "paragraph")
    throw new Error(`expected a paragraph, got ${para.type}`);
  return para.children
    .map((n: PhrasingContent) =>
      n.type === "html" ? htmlText(n.value) : n.type === "text" ? n.value : ""
    )
    .join("");
}

describe("inline HTML in a reply", () => {
  it("drops tags and keeps what they wrapped", () => {
    expect(shown('- <span style="color: red;">Red bullet</span>')).toBe(
      "Red bullet"
    );
    expect(shown("a <b>bold</b><br/> word")).toBe("a bold word");
  });

  it("keeps prose that only looks like a tag", () => {
    expect(shown("Use Array<string> here")).toBe("Use Array<string> here");
    expect(shown("Render <Component /> or Map<K, V>")).toBe(
      "Render <Component /> or Map<K, V>"
    );
  });

  it("skips a > inside a quoted attribute", () => {
    expect(htmlText('<span title="a>b">x</span>')).toBe("x");
    expect(htmlText("<a href='x>y'>link</a>")).toBe("link");
  });

  it("drops comments and script tags as text, running nothing", () => {
    expect(htmlText("<!-- note -->hi<script>alert(1)</script>")).toBe(
      "hialert(1)"
    );
  });
});

describe("hostile input", () => {
  it("strips a reply full of unclosed tags in linear time", () => {
    for (const evil of [
      "<div\n" + "<a".repeat(200_000),
      '<span title="' + "<b".repeat(200_000),
    ]) {
      const start = performance.now();
      htmlText(evil);
      expect(performance.now() - start).toBeLessThan(250);
    }
  });
});

describe("block HTML in a reply", () => {
  it("is its text, or nothing when it was only tags", () => {
    const blocks = parseMarkdown("<div>\n\n</div>\n\n<div>hi</div>").children;
    expect(
      blocks.map((b) => (b.type === "html" ? htmlBlockText(b.value) : b.type))
    ).toEqual([null, null, "hi"]);
  });
});
