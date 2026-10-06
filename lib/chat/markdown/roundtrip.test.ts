import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { docToMarkdown } from "./serialize";
import { markdownToDoc } from "./parse";

// Property: for any markdown, parse then serialize gives the identical
// string. The corpus is the shapes that used to drift, plus text that only
// looks like markdown; documents are built by joining random pieces.
const PIECES = [
  "1. a\n1. b\n1. c",
  "1) a\n2) b",
  "3. c\n4. d",
  "- a\n\n- b\n\n- c",
  "* [ ] star task\n* [x] done",
  "+ [ ] plus task",
  "+ plus\n+ list",
  "~~~py\nprint(1)\n~~~",
  '```ts title="a.ts" {1,3}\nconst a = 1;\n```',
  "````\n```nested```\n````",
  "`` a ``",
  "``` `` ```",
  "a `b` c and ``d ` e``",
  "- lazy\ncontinuation",
  "1. item\nlazy too",
  "snake_case_name and __init__.py",
  "glob src/**/*.ts and *.md and a * b",
  "<div>tag</div> and <br/> inline",
  "<details>\n<summary>x</summary>\n</details>",
  "# a leading hash",
  "#hashtag not a heading",
  "trailing spaces   ",
  "hard  \nbreak",
  "emoji 🎉 and ✓ and 日本語",
  "**bold** _it_ *em* __strong__ ~~gone~~ ~one~",
  "***both*** and **_mixed_**",
  "> quoted\n> lines",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "[link](https://x.y) https://bare.url",
  "\\*escaped\\* &amp; &#35;",
  "- a\n  - nested\n    - deeper\n- b",
  "- item\n\n  ```sh\n  ls\n  ```",
  "```\nunclosed fence",
  "  indented line",
  "---",
  "",
];
const SEPARATORS = ["\n", "\n\n", "\n\n\n"];

// Deterministic, so a failure reproduces.
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

const roundTrip = (md: string) => docToMarkdown(markdownToDoc(md));

describe("markdown round trip, as a property", () => {
  it.each(PIECES)("%j alone", (md) => expect(roundTrip(md)).toBe(md));

  it("holds for 500 random documents", () => {
    const next = random(42);
    const pick = <T>(xs: T[]) => xs[Math.floor(next() * xs.length)];
    for (let i = 0; i < 500; i++) {
      const parts = Array.from({ length: 1 + Math.floor(next() * 5) }, () =>
        pick(PIECES)
      );
      const md = parts.reduce((acc, p) => acc + pick(SEPARATORS) + p);
      expect(roundTrip(md), JSON.stringify(md)).toBe(md);
    }
  });
});

describe("shapes stay formatted, not just text", () => {
  const types = (md: string) =>
    (markdownToDoc(md).content ?? []).map((n: JSONContent) => n.type);

  it.each([
    ["1. a\n1. b", "orderedList"],
    ["1) a\n2) b", "orderedList"],
    ["- a\n\n- b", "bulletList"],
    ["* [ ] a", "taskList"],
    ["~~~py\nx\n~~~", "codeBlock"],
    ["- lazy\ncontinuation", "bulletList"],
    ["- a\n  - b\n  lazy under b", "bulletList"],
    ['```ts title="a"\nx\n```', "codeBlock"],
  ])("%j", (md, type) => expect(types(md)).toEqual([type]));

  it("keeps padded inline code as code", () => {
    const [p] = markdownToDoc("`` a ``").content ?? [];
    expect(p.content?.[0].marks?.[0].type).toBe("code");
  });
});
