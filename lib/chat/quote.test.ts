import { describe, expect, it } from "vitest";
import { markdownParagraphs, quoteMarkdown } from "./quote";

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
