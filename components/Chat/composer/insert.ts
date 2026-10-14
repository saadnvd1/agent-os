import type { Editor } from "@tiptap/core";
import type { markdownParagraphs } from "@/lib/chat/quote";

// Puts paragraphs in at the caret, or with `append` after everything already
// written (on new lines), leaving the caret after them.
export function insertMarkdown(
  editor: Editor,
  content: ReturnType<typeof markdownParagraphs>,
  append = false
) {
  if (append && !editor.isEmpty) {
    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, content)
      .focus("end")
      .run();
  } else editor.chain().focus().insertContent(content).run();
}
