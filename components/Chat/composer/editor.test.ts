import { clipboard } from "./test-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { docToMarkdown } from "@/lib/chat/markdown/serialize";
import { markdownToDoc } from "@/lib/chat/markdown/parse";
import { plainExtensions, richExtensions } from "./extensions";
import { handlePaste, type PasteHandlers } from "./paste";
import { handleKeyDown, type KeyHandlers } from "./keys";

let editor: Editor;
afterEach(() => editor?.destroy());

const make = (plain = false) => {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: plain ? plainExtensions(() => "") : richExtensions(() => ""),
  });
  return editor;
};

const md = () => docToMarkdown(editor.getJSON());

// Types like a keyboard: each character goes through the input rules, and
// "\n" is Enter as a touch keyboard sends it (a newline, never a send).
function type(text: string) {
  for (const ch of text) {
    if (ch === "\n") {
      press("Enter", { coarse: true });
      continue;
    }
    const { view } = editor;
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(ch, from, to);
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, deflt)
    );
    if (!handled) view.dispatch(deflt());
  }
}

const keys = (over: Partial<KeyHandlers> = {}): KeyHandlers => ({
  plain: false,
  menuOpen: false,
  menuHasMatches: false,
  onMenuKey: () => {},
  onSend: () => {},
  onTogglePlain: () => {},
  onPasteAsText: () => {},
  ...over,
});

function press(
  key: string,
  opts: { shift?: boolean; coarse?: boolean } = {},
  h = keys()
) {
  window.matchMedia = ((q: string) => ({
    matches: Boolean(opts.coarse) && q.includes("coarse"),
  })) as never;
  const event = new KeyboardEvent("keydown", { key, shiftKey: opts.shift });
  if (!handleKeyDown(editor, event, h)) {
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));
  }
}

describe("typing live markdown", () => {
  it.each([
    ["inline code", "run `npm test` now", "inlineCode"],
    ["bold", "a **strong** word", "bold"],
    ["italic", "an _em_ word and *star*", "italic"],
    ["bullets", "- one\ntwo", "bulletList"],
    ["star bullets", "* one\ntwo", "bulletList"],
    ["numbers", "1. one\ntwo", "orderedList"],
    ["tasks", "- [ ] buy milk\nfix build", "taskList"],
    ["checked task", "[x] done", "taskList"],
  ])("%s become nodes and serialize as typed", (_, typed) => {
    make();
    type(typed);
    const expected = typed
      .replace("- one\ntwo", "- one\n- two")
      .replace("* one\ntwo", "* one\n* two")
      .replace("1. one\ntwo", "1. one\n2. two")
      .replace("- [ ] buy milk\nfix build", "- [ ] buy milk\n- [ ] fix build")
      .replace("[x] done", "- [x] done");
    expect(md()).toBe(expected);
  });

  it("marks render as marks, not characters", () => {
    make();
    type("a **b** `c`");
    expect(editor.getText()).toBe("a b c");
  });

  it("```ts then Enter opens a code block", () => {
    make();
    type("```ts");
    press("Enter");
    type("const a = 1;\nconst b = 2;");
    expect(editor.getJSON().content?.[0].type).toBe("codeBlock");
    expect(md()).toBe("```ts\nconst a = 1;\nconst b = 2;\n```");
  });

  it("three Shift+Enters at the end of a code block leave it", () => {
    make();
    type("```");
    press("Enter");
    type("x");
    for (let i = 0; i < 3; i++) press("Enter", { shift: true });
    type("after");
    expect(md()).toBe("```\nx\n```\nafter");
  });

  it("Shift+Enter is a newline, not a hard break", () => {
    make();
    type("a");
    press("Enter", { shift: true });
    type("b");
    expect(md()).toBe("a\nb");
  });

  it("plain mode keeps every marker literal", () => {
    make(true);
    type("**not bold** and `not code`\n- not a list");
    expect(md()).toBe("**not bold** and `not code`\n- not a list");
    expect(editor.getText()).toContain("**");
  });

  it("a markdown draft loads back to the same markdown", () => {
    make();
    const draft = "fix `x`:\n\n- **one**\n- [link](u)\n\n```py\nprint(1)\n```";
    editor.commands.setContent(markdownToDoc(draft));
    expect(md()).toBe(draft);
  });
});

function paste(
  text: string,
  extra: Record<string, string> = {},
  h: Partial<PasteHandlers> = {}
) {
  const event = clipboard({ "text/plain": text, ...extra });
  return handlePaste(editor.view, event, {
    plain: false,
    asText: false,
    onImages: () => {},
    onLongPaste: () => {},
    ...h,
  });
}

describe("pasting", () => {
  it("code goes into a code block", () => {
    make();
    type("look: ");
    paste("function a() {\n  return 1;\n}\n");
    expect(md()).toBe("look: \n```\nfunction a() {\n  return 1;\n}\n```\n");
  });

  it("uses VS Code's language", () => {
    make();
    paste("x\ny", {
      "vscode-editor-data": JSON.stringify({ mode: "typescriptreact" }),
    });
    expect(md()).toBe("```tsx\nx\ny\n```\n");
  });

  it("prose stays prose, byte for byte", () => {
    make();
    const prose =
      "Thanks for looking.\n\nThe build broke after the merge, can you check?";
    paste(prose);
    expect(md()).toBe(prose);
    expect(editor.getJSON().content?.every((n) => n.type === "paragraph")).toBe(
      true
    );
  });

  it("markdown prose is formatted and sent back unchanged", () => {
    make();
    const text = "Steps:\n- run `npm i`\n- **then** test";
    paste(text);
    expect(md()).toBe(text);
  });

  it("paste as text skips formatting", () => {
    make();
    paste("function a() {\n  return 1;\n}", {}, { asText: true });
    expect(editor.getJSON().content?.[0].type).toBe("paragraph");
    expect(md()).toBe("function a() {\n  return 1;\n}");
  });

  it("a long paste becomes an attachment", () => {
    make();
    let got = "";
    paste("x".repeat(40_000), {}, { onLongPaste: (t) => (got = t) });
    expect(got.length).toBe(40_000);
    expect(md()).toBe("");
  });

  it("inside a code block, text goes in raw", () => {
    make();
    type("```");
    press("Enter");
    paste("- not a list\n**raw**");
    expect(md()).toBe("```\n- not a list\n**raw**\n```");
  });
});

describe("Enter", () => {
  it("sends on a keyboard and is a newline on touch", () => {
    make();
    let sent = 0;
    const h = keys({ onSend: () => sent++ });
    type("hi");
    press("Enter", {}, h);
    expect(sent).toBe(1);
    press("Enter", { coarse: true }, h);
    expect(sent).toBe(1);
    expect(md()).toBe("hi\n");
  });

  it("picks from the command menu instead of sending", () => {
    make();
    const got: string[] = [];
    const h = keys({
      menuOpen: true,
      menuHasMatches: true,
      onMenuKey: (k) => got.push(k),
      onSend: () => got.push("send"),
    });
    press("ArrowDown", {}, h);
    press("Enter", {}, h);
    press("Escape", {}, h);
    expect(got).toEqual(["down", "pick", "close"]);
  });
});
