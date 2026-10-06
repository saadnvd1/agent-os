import { markInputRule, wrappingInputRule } from "@tiptap/core";
import Bold, {
  starInputRegex as boldStar,
  underscoreInputRegex as boldUnderscore,
} from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import HardBreak from "@tiptap/extension-hard-break";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import Italic, {
  starInputRegex as italicStar,
  underscoreInputRegex as italicUnderscore,
} from "@tiptap/extension-italic";
import {
  BulletList,
  bulletListInputRegex,
  OrderedList,
  TaskItem,
  TaskList,
} from "@tiptap/extension-list";
import Strike from "@tiptap/extension-strike";

// Marks and blocks that remember the characters they were typed with, so
// the markdown sent is what was typed: *a* stays *a*, "1)" stays "1)",
// ~~~ stays ~~~. None of these attributes reach the DOM.
const kept = (attrs: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(attrs).map(([k, v]) => [k, { default: v, rendered: false }])
  );

const markRules = (
  type: Parameters<typeof markInputRule>[0]["type"],
  rules: [RegExp, string][]
) =>
  rules.map(([find, delim]) =>
    markInputRule({ find, type, getAttributes: { delim } })
  );

export const ComposerBold = Bold.extend({
  addAttributes: () => kept({ delim: "**" }),
  addInputRules() {
    return markRules(this.type, [
      [boldStar, "**"],
      [boldUnderscore, "__"],
    ]);
  },
});

export const ComposerItalic = Italic.extend({
  addAttributes: () => kept({ delim: "_" }),
  addInputRules() {
    return markRules(this.type, [
      [italicStar, "*"],
      [italicUnderscore, "_"],
    ]);
  },
});

export const ComposerStrike = Strike.extend({
  addAttributes: () => kept({ delim: "~~" }),
});

export const ComposerCode = Code.extend({
  addAttributes: () => kept({ delim: null }),
});

export const ComposerBulletList = BulletList.extend({
  addAttributes: () => kept({ marker: "-", gap: 0 }),
  addInputRules() {
    return [
      wrappingInputRule({
        find: bulletListInputRegex,
        type: this.type,
        getAttributes: (match) => ({ marker: match[1] }),
      }),
    ];
  },
});

export const ComposerOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...kept({ delim: ".", repeat: false, gap: 0 }),
    };
  },
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^(\d+)([.)])\s$/,
        type: this.type,
        getAttributes: (match) => ({ start: +match[1], delim: match[2] }),
        joinPredicate: (match, node) =>
          node.childCount + node.attrs.start === +match[1],
      }),
    ];
  },
});

export const ComposerTaskList = TaskList.extend({
  addAttributes: () => kept({ marker: "-", gap: 0 }),
});

// No "[ ] " rule of its own: at the start of a line that's text. TaskShortcut
// handles "- [ ] ".
export const ComposerTaskItem = TaskItem.extend({
  addInputRules: () => [],
});

export const ComposerCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return { ...this.parent?.(), ...kept({ fence: null, info: null }) };
  },
});

// A line break that came from a lazy continuation line in pasted or restored
// markdown, written back without the list's indent.
export const ComposerHardBreak = HardBreak.extend({
  addAttributes: () => kept({ lazy: false }),
});
