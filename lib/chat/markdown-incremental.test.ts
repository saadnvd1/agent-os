import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { incrementalParser } from "./markdown-incremental";

const processor = unified().use(remarkParse).use(remarkGfm);
const full = (source: string) => processor.parse(source) as Root;

// Every prefix of a streamed message parses to the same tree incrementally as
// it does from scratch.
function streamed(text: string, step = 7) {
  let calls = 0;
  const parse = incrementalParser((source) => {
    calls++;
    return full(source);
  });
  for (let n = step; n < text.length + step; n += step) {
    const source = text.slice(0, n);
    expect(parse(source, undefined as never)).toEqual(full(source));
  }
  return calls;
}

describe("incrementalParser", () => {
  it("matches a full parse at every point of a message with code", () => {
    streamed(
      "Intro text.\n\n```ts\nconst a = 1;\n```\n\nMiddle with **bold**.\n\n~~~\nraw\n~~~\n\n- a list\n- of things\n\n```js\nlet b = 2;\n"
    );
  });

  it("reparses the whole document when a definition appears", () => {
    streamed("```\nx\n```\n\nSee [the docs][d].\n\n[d]: https://example.com\n");
  });

  it("falls back to full parses around CRs", () => {
    streamed("```\na\r\n```\r\n\r\ntext\r\n");
  });

  it("reuses the finished prefix rather than parsing it again", () => {
    const sizes: number[] = [];
    const parse = incrementalParser((source) => {
      sizes.push(source.length);
      return full(source);
    });
    const head = "```\n" + "x\n".repeat(200) + "```\n\n";
    parse(head + "a", undefined as never);
    parse(head + "ab", undefined as never);
    expect(sizes[1]).toBe(2);
  });
});
