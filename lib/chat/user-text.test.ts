import { describe, expect, it } from "vitest";
import { splitInlineCode, splitUserText } from "./user-text";

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
