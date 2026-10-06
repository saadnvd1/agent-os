import type { AnyExtension } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import {
  ComposerBold,
  ComposerBulletList,
  ComposerCode,
  ComposerCodeBlock,
  ComposerHardBreak,
  ComposerItalic,
  ComposerOrderedList,
  ComposerStrike,
  ComposerTaskItem,
  ComposerTaskList,
} from "./shapes";
import { TaskShortcut } from "./taskShortcut";

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
      strike: false,
      code: false,
      bulletList: false,
      orderedList: false,
      hardBreak: false,
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
    ComposerStrike,
    ComposerCode,
    ComposerHardBreak,
    ComposerBulletList,
    ComposerOrderedList,
    ComposerTaskList,
    ComposerTaskItem.configure({ nested: true }),
    TaskShortcut,
    ComposerCodeBlock.configure({
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
