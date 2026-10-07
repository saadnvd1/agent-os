import { describe, expect, it } from "vitest";
import { chunk, imageUrls } from "./chunks";
import { parseMarkdown } from "./parse";

const kinds = (md: string) =>
  chunk(parseMarkdown(md).children).map((c) => c.kind);

describe("chunk", () => {
  it("joins consecutive prose into one selectable chunk", () => {
    expect(kinds("# Title\n\nOne.\n\n- a\n- b\n\nTwo.")).toEqual(["prose"]);
  });

  it("gives code, tables and quotes their own views, between prose", () => {
    expect(
      kinds(
        "Intro.\n\n```js\nx\n```\n\nMid.\n\n> quote\n\n| a |\n|---|\n| 1 |\n\nEnd."
      )
    ).toEqual(["prose", "block", "prose", "block", "block", "prose"]);
  });

  it("draws an image-only paragraph as images, and keeps inline images in prose", () => {
    expect(kinds("![a](https://x/a.png) ![b](https://x/b.png)")).toEqual([
      "images",
    ]);
    expect(kinds("See ![a](https://x/a.png) here")).toEqual(["prose"]);
  });

  it("keys chunks by source offset, so streaming more text keeps earlier keys", () => {
    const a = chunk(parseMarkdown("One.\n\n```js\nx").children).map(
      (c) => c.key
    );
    const b = chunk(
      parseMarkdown("One.\n\n```js\nx\ny\n```\n\nMore").children
    ).map((c) => c.key);
    expect(b.slice(0, 2)).toEqual(a);
  });
});

describe("imageUrls", () => {
  it("lists every image in order, inline ones too", () => {
    const tree = parseMarkdown(
      "![a](https://x/a.png)\n\nText ![b](https://x/b.png)"
    );
    expect(imageUrls(tree.children)).toEqual([
      "https://x/a.png",
      "https://x/b.png",
    ]);
  });
});
