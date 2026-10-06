import { describe, expect, it } from "vitest";
import {
  nextAttachment,
  classifyPaste,
  composeMessage,
  LONG_PASTE_BYTES,
} from "./paste";

const kind = (
  text: string,
  extra: { html?: string; editorMode?: string } = {}
) => classifyPaste({ text, ...extra }).kind;

const CODE = {
  typescript: "export function add(a: number, b: number) {\n  return a + b;\n}",
  python: "def greet(name):\n    print(f\"hi {name}\")\n\ngreet('x')",
  json: '{\n  "name": "agent-os",\n  "private": true\n}',
  shell: "npm install\nnpm run dev\ngit status",
  css: ".card {\n  color: red;\n  padding: 4px;\n}",
  stack:
    "TypeError: x is undefined\n    at foo (app.js:1:2)\n    at bar (app.js:9:4)",
  jsx: "<div>\n  <Button onClick={go}>Go</Button>\n</div>",
};

const PROSE = {
  paragraphs:
    "Thanks for the review. I fixed the bug you found.\n\nThe tests pass now, and I updated the docs too.",
  email:
    "Hi Sam,\nCan you look at the deploy when you get a chance?\nThe build failed again this morning.",
  list: "- buy milk\n- fix the build\n- call mom",
  fenced: "Here is the fix:\n\n```ts\nconst a = 1;\n```\n\nIt works.",
  numbered: "1. Open the app\n2. Click settings\n3. Turn it off",
};

describe("classifyPaste", () => {
  it.each(Object.entries(CODE))("%s is code", (_, text) => {
    expect(kind(text)).toBe("code");
  });

  it.each(Object.entries(PROSE))("%s stays prose", (_, text) => {
    expect(kind(text)).toBe("markdown");
  });

  it("a single line is inserted as is, even code", () => {
    expect(kind("const a = 1;")).toBe("inline");
    expect(kind("just words\n")).toBe("inline");
  });

  it("trusts the editor's language when VS Code says so", () => {
    expect(classifyPaste({ text: "a\nb", editorMode: "rust" })).toEqual({
      kind: "code",
      language: "rust",
    });
    expect(
      kind("Some words.\nMore words here.", { editorMode: "markdown" })
    ).toBe("markdown");
  });

  it("treats a <pre> from an editor as code", () => {
    expect(
      kind("foo bar\nbaz qux", { html: "<pre>foo bar\nbaz qux</pre>" })
    ).toBe("code");
  });

  it("32 KiB or more becomes an attachment, measured in bytes", () => {
    expect(kind("a".repeat(LONG_PASTE_BYTES))).toBe("attachment");
    expect(kind("a".repeat(LONG_PASTE_BYTES - 1))).not.toBe("attachment");
    // 3 bytes each: under the limit in characters, over it in bytes.
    expect(kind("€".repeat(Math.ceil(LONG_PASTE_BYTES / 3)))).toBe(
      "attachment"
    );
  });
});

describe("attachments", () => {
  it("names them like files", () => {
    expect(nextAttachment([], 0).name).toBe("pasted-text.txt");
    const one = { name: "pasted-text.txt", text: "" };
    expect(nextAttachment([one], 1).name).toBe("pasted-text-2.txt");
  });

  it("never reuses a name after one is removed", () => {
    // Pasted 1, 2, 3; removed 3 (the newest) and 1.
    const two = { name: "pasted-text-2.txt", text: "" };
    expect(nextAttachment([two], 3)).toEqual({
      name: "pasted-text-4.txt",
      number: 4,
    });
    // A restored draft: numbers come from the names still attached.
    expect(nextAttachment([two], 0).name).toBe("pasted-text-3.txt");
  });

  it("sends them as fenced blocks after the message", () => {
    const msg = composeMessage("look at this\n\n", [
      { name: "a", text: "line\n" },
      { name: "b", text: "has ``` inside", language: "ts" },
    ]);
    expect(msg).toBe(
      "look at this\n\n```\nline\n```\n\n````ts\nhas ``` inside\n````"
    );
  });

  it("sends just the attachment when nothing is typed", () => {
    expect(composeMessage("", [{ name: "a", text: "x" }])).toBe("```\nx\n```");
  });
});
