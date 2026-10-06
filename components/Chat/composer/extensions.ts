import {
  markInputRule,
  wrappingInputRule,
  type AnyExtension,
} from "@tiptap/core";
import Bold, {
  starInputRegex as boldStar,
  underscoreInputRegex as boldUnderscore,
} from "@tiptap/extension-bold";
import Italic, {
  starInputRegex as italicStar,
  underscoreInputRegex as italicUnderscore,
} from "@tiptap/extension-italic";
import {
  BulletList,
  bulletListInputRegex,
  TaskItem,
  TaskList,
} from "@tiptap/extension-list";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { TaskShortcut } from "./taskShortcut";

// Each mark and list remembers the characters it was typed with, so the
// markdown sent is what was typed: *a* stays *a*, _a_ stays _a_.
const delim = (fallback: string) => ({
  delim: { default: fallback, rendered: false },
});

const ComposerBold = Bold.extend({
  addAttributes: () => delim("**"),
  addInputRules() {
    return [
      markInputRule({
        find: boldStar,
        type: this.type,
        getAttributes: { delim: "**" },
      }),
      markInputRule({
        find: boldUnderscore,
        type: this.type,
        getAttributes: { delim: "__" },
      }),
    ];
  },
});

const ComposerItalic = Italic.extend({
  addAttributes: () => delim("_"),
  addInputRules() {
    return [
      markInputRule({
        find: italicStar,
        type: this.type,
        getAttributes: { delim: "*" },
      }),
      markInputRule({
        find: italicUnderscore,
        type: this.type,
        getAttributes: { delim: "_" },
      }),
    ];
  },
});

const ComposerBulletList = BulletList.extend({
  addAttributes: () => ({ marker: { default: "-", rendered: false } }),
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

// LumifyHub's code block setup: common languages, and a language lowlight
// doesn't know falls back to plain text instead of throwing.
const lowlight = createLowlight(common);

type Text = () => string;

const placeholder = (text: Text) =>
  Placeholder.configure({ placeholder: text });

// Nothing here becomes markdown the composer can't write back: no headings,
// quotes, rules or links; those stay the characters typed.
export function richExtensions(text: Text): AnyExtension[] {
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      blockquote: false,
      horizontalRule: false,
      link: false,
      underline: false,
      trailingNode: false,
    }),
    ComposerBold,
    ComposerItalic,
    ComposerBulletList,
    TaskList,
    TaskItem.configure({ nested: true }),
    TaskShortcut,
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      enableTabIndentation: true,
      HTMLAttributes: {
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    }),
    placeholder(text),
  ];
}

// Plain mode: paragraphs of text and nothing else, so it serializes byte
// for byte.
export function plainExtensions(text: Text): AnyExtension[] {
  return [
    StarterKit.configure({
      bold: false,
      italic: false,
      strike: false,
      code: false,
      codeBlock: false,
      heading: false,
      blockquote: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      hardBreak: false,
      link: false,
      underline: false,
      trailingNode: false,
    }),
    placeholder(text),
  ];
}
