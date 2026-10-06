import type { Editor, JSONContent } from "@tiptap/core";
import { markdownToDoc, textToDoc } from "@/lib/chat/markdown/parse";

export const toDoc = (md: string, plain: boolean): JSONContent =>
  plain ? textToDoc(md) : markdownToDoc(md);

// Puts a document in the editor without it counting as an edit. Content the
// schema can't hold would otherwise be swapped for an empty doc, leaving
// text the user can't see but would still send; it goes in as plain lines.
export function loadDoc(editor: Editor, doc: JSONContent, md: string): void {
  try {
    editor.commands.setContent(doc, {
      emitUpdate: false,
      errorOnInvalidContent: true,
    });
  } catch {
    editor.commands.setContent(textToDoc(md), { emitUpdate: false });
  }
}

export const loadMarkdown = (editor: Editor, md: string, plain: boolean) =>
  loadDoc(editor, toDoc(md, plain), md);
