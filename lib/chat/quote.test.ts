import { describe, expect, it } from "vitest";
import { markdownParagraphs, quoteInsert, quoteMarkdown } from "./quote";

describe("quoteMarkdown", () => {
  it("quotes a sentence, with a blank line after", () => {
    expect(quoteMarkdown("It runs in a worker.")).toBe(
      "> It runs in a worker.\n\n"
    );
  });

  it("quotes every line, blank ones included", () => {
    expect(quoteMarkdown("one\n\ntwo\n")).toBe("> one\n>\n> two\n\n");
  });

  it("has nothing to quote in whitespace", () => {
    expect(quoteMarkdown("  \n ")).toBe("");
  });
});

describe("markdownParagraphs", () => {
  it("is one paragraph per line, ending where the reader writes", () => {
    expect(markdownParagraphs("> a\n\n")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "> a" }] },
      { type: "paragraph" },
      { type: "paragraph" },
    ]);
  });
});

describe("quoting a whole message", () => {
  it("keeps code blocks and lists, quoting every line", () => {
    const md = "Steps:\n\n- one\n- two\n\n```ts\nconst a = 1;\n```";
    expect(quoteMarkdown(md)).toBe(
      "> Steps:\n>\n> - one\n> - two\n>\n> ```ts\n> const a = 1;\n> ```\n\n"
    );
  });

  it("asks to go after an existing draft, with the cursor after the quote", () => {
    const ins = quoteInsert("hi\nthere", 7);
    expect(ins).toEqual({ text: "> hi\n> there\n\n", at: 7, append: true });
    const paras = markdownParagraphs(ins.text);
    expect(paras.at(-1)).toEqual({ type: "paragraph" });
  });
});
