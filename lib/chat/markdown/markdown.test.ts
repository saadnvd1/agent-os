import { describe, expect, it } from "vitest";
import { docToMarkdown } from "./serialize";
import { markdownToDoc, textToDoc } from "./parse";

const roundTrip = (md: string) => docToMarkdown(markdownToDoc(md));

const SAME = [
  "",
  "hello",
  "line one\nline two",
  "a\n\nb",
  "a\n\n\n\nb",
  "\n\nlead and trail\n\n",
  "use `npm test` here",
  "``code with ` tick``",
  "**bold** and _italic_ and *star* and __under__ and ~~gone~~",
  "**bold _both_ bold**",
  "snake_case_name and a * b and 2*3*4",
  "an \\*escaped\\* star and &amp; entity",
  "- one\n- two\n  - nested\n- three",
  "* star\n* list",
  "1. first\n2. second",
  "3. starts at three\n4. four",
  "- [ ] todo\n- [x] done",
  "- a\n- b\n\nafter the list",
  "- a\n\n```sh\nls\n```",
  "- a\n",
  "- a\n\n",
  "```ts\nconst a = 1;\n\nconsole.log(a);\n```",
  "```\nno language\n```",
  "text\n```py\nprint(1)\n```\nmore",
  "````md\n```inner```\n````",
  "# heading stays literal\n> quote too\n---",
  "[a link](https://x.y) and https://bare.url",
  "| a | b |\n| - | - |\n| 1 | 2 |",
  "  indented first line",
  "hard  \nbreak",
  "- item\n\n  ```sh\n  ls -la\n  ```",
  "/review the auth module",
  "/review ",
  "trailing spaces  \nnext",
];

describe("markdown round trip", () => {
  it.each(SAME)("keeps %j byte for byte", (md) => {
    expect(roundTrip(md)).toBe(md);
  });

  it("is stable on a second pass", () => {
    for (const md of SAME) expect(roundTrip(roundTrip(md))).toBe(roundTrip(md));
  });

  it("plain text keeps every character", () => {
    const text = "**not bold**\n\n- not a list\n```\nnot code";
    expect(docToMarkdown(textToDoc(text))).toBe(text);
  });

  it("builds real nodes for what it understands", () => {
    const doc = markdownToDoc("- [x] done\n\n```ts\nx\n```");
    expect(doc.content?.map((n) => n.type)).toEqual([
      "taskList",
      "paragraph",
      "codeBlock",
    ]);
    expect(doc.content?.[2].attrs?.language).toBe("ts");
  });
});
