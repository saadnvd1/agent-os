import { describe, expect, it } from "vitest";
import { splitInlineCode, splitProse, splitUserText } from "./user-text";

describe("splitUserText", () => {
  it("splits a fenced block from the text before it, keeping tabs", () => {
    const body =
      "Permissions\tResources\tStatus\nagentos dns\tZone.DNS\t1 Zone";
    expect(
      splitUserText(`i thought there was a tokens?\n\`\`\`\n${body}\n\`\`\``)
    ).toEqual([
      { kind: "text", text: "i thought there was a tokens?" },
      { kind: "code", code: body, language: undefined },
    ]);
  });

  it("reads a language and text after the block", () => {
    expect(splitUserText("a\n```ts\nlet x = 1\n```\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "code", code: "let x = 1", language: "ts" },
      { kind: "text", text: "b" },
    ]);
  });

  it("runs an unclosed fence to the end", () => {
    expect(splitUserText("```\nx\ny")).toEqual([
      { kind: "code", code: "x\ny", language: undefined },
    ]);
  });

  it("leaves plain multi-line text unchanged", () => {
    const t = "line one\n\n* a *b* _c_ <b>x</b>\n  indented";
    expect(splitUserText(t)).toEqual([{ kind: "text", text: t }]);
  });
});

describe("splitInlineCode", () => {
  it("pulls out backtick spans only", () => {
    expect(splitInlineCode("run `npm test` now *ok*")).toEqual([
      { code: false, text: "run " },
      { code: true, text: "npm test" },
      { code: false, text: " now *ok*" },
    ]);
  });
  it("returns plain text whole", () => {
    expect(splitInlineCode("a_b_c")).toEqual([{ code: false, text: "a_b_c" }]);
  });
});

describe("splitProse", () => {
  const links = (t: string) =>
    splitProse(t)
      .filter((p) => p.kind === "link")
      .map((p) => p.text);

  it("links a plain URL and keeps the text around it", () => {
    expect(splitProse("see https://example.com now")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "https://example.com" },
      { kind: "text", text: " now" },
    ]);
  });
  it("keeps the query string and fragment", () => {
    const u = "http://localhost:3443/?session=ab80e6fd-1&x=2#h";
    expect(links(`open ${u}`)).toEqual([u]);
  });
  it("leaves trailing punctuation outside the link", () => {
    for (const end of [".", ",", ";", ":", "!", "?", "?!"]) {
      expect(splitProse(`go https://example.com/a${end}`)).toEqual([
        { kind: "text", text: "go " },
        { kind: "link", text: "https://example.com/a" },
        { kind: "text", text: end },
      ]);
    }
  });
  it("leaves an unmatched closing paren out, keeps a matched one", () => {
    expect(splitProse("(https://example.com/a)")).toEqual([
      { kind: "text", text: "(" },
      { kind: "link", text: "https://example.com/a" },
      { kind: "text", text: ")" },
    ]);
    expect(links("https://example.com/wiki/Foo_(bar)")).toEqual([
      "https://example.com/wiki/Foo_(bar)",
    ]);
    expect(links("(see https://example.com/a_(b)).")).toEqual([
      "https://example.com/a_(b)",
    ]);
  });
  it("finds two URLs in one message", () => {
    expect(links("https://a.example and https://b.example/x")).toEqual([
      "https://a.example",
      "https://b.example/x",
    ]);
  });
  it("does not link a URL inside inline code", () => {
    expect(
      splitProse("run `curl https://x.example` then https://y.example")
    ).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "curl https://x.example" },
      { kind: "text", text: " then " },
      { kind: "link", text: "https://y.example" },
    ]);
  });
  it("ignores a bare scheme and text without URLs", () => {
    expect(links("https:// nothing")).toEqual([]);
    expect(splitProse("plain")).toEqual([{ kind: "text", text: "plain" }]);
  });
});

describe("splitUserText spacing", () => {
  it("drops the blank lines a block's own margin already covers", () => {
    expect(splitUserText("a\n\n```ts\nx\n```\n\nb")).toEqual([
      { kind: "text", text: "a" },
      { kind: "code", code: "x", language: "ts" },
      { kind: "text", text: "b" },
    ]);
  });
});
