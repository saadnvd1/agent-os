import { describe, expect, it } from "vitest";
import { highlight, highlightStreaming, languageOf } from "./highlight";
import { ONE_DARK, tokenColor } from "./theme";

const text = (line: { text: string }[]) => line.map((t) => t.text).join("");

describe("highlight", () => {
  it("colours tokens the way the web's One Dark does", () => {
    const [line] = highlight('const a = "hi";', "js");
    const keyword = line.find((t) => t.text === "const")!;
    const str = line.find((t) => t.text === '"hi"')!;
    expect(tokenColor(keyword.types, ONE_DARK)).toBe("hsl(286, 60%, 67%)");
    expect(tokenColor(str.types, ONE_DARK)).toBe("hsl(95, 38%, 62%)");
  });

  it("keeps every character and splits tokens that span lines", () => {
    const code = "/* a\nb */\nlet x = 1;\n";
    const lines = highlight(code, "ts");
    expect(lines.map(text).join("\n")).toBe(code);
    expect(lines).toHaveLength(4);
    expect(tokenColor(lines[1][0].types, ONE_DARK)).toBe(ONE_DARK.comment);
  });

  it("leaves unknown languages plain", () => {
    expect(languageOf("nope")).toBeNull();
    expect(highlight("x y", "nope")).toEqual([[{ text: "x y", types: [] }]]);
  });

  it("caches results", () => {
    expect(highlight("let y = 2;", "js")).toBe(highlight("let y = 2;", "js"));
  });
});

describe("highlightStreaming", () => {
  it("colours finished lines and leaves the one being written plain", () => {
    const lines = highlightStreaming("const a = 1;\nconst b", "js");
    expect(tokenColor(lines[0][0].types, ONE_DARK)).toBe(ONE_DARK.keyword);
    expect(lines[1]).toEqual([{ text: "const b", types: [] }]);
  });

  it("reuses the finished prefix as the reply grows", () => {
    const a = highlightStreaming("let a = 1;\nlet", "js");
    const b = highlightStreaming("let a = 1;\nlet b", "js");
    expect(a[0]).toBe(b[0]);
  });
});
