import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { markdownToDoc, textToDoc } from "@/lib/chat/markdown/parse";
import { classifyPaste } from "@/lib/chat/paste";

export interface PasteHandlers {
  plain: boolean;
  // Cmd/Ctrl+Shift+V was pressed just before this paste.
  asText: boolean;
  onImages: (files: File[]) => void;
  onLongPaste: (text: string, language?: string) => void;
}

// Dragged files sometimes arrive without a type; go by the name then.
export const isImage = (f: File) =>
  f.type.startsWith("image/") ||
  (!f.type && /\.(png|jpe?g|gif|webp|heic)$/i.test(f.name));

function editorMode(data: DataTransfer): string | undefined {
  try {
    const mode: unknown = JSON.parse(data.getData("vscode-editor-data"))?.mode;
    return typeof mode === "string" ? mode : undefined;
  } catch {
    return undefined;
  }
}

// A paragraph at either end merges into the one the cursor is in.
function insertDoc(view: EditorView, json: JSONContent): void {
  const { schema } = view.state;
  const content: Fragment = schema.nodeFromJSON(json).content;
  const open = (n: typeof content.firstChild) =>
    n?.type === schema.nodes.paragraph ? 1 : 0;
  const slice = new Slice(
    content,
    open(content.firstChild),
    open(content.lastChild)
  );
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

function insertCode(view: EditorView, code: string, language?: string): void {
  const { codeBlock, paragraph } = view.state.schema.nodes;
  const block = codeBlock.create(
    { language: language ?? null },
    code ? view.state.schema.text(code) : null
  );
  // A paragraph after it, so typing can carry on below the code.
  const slice = new Slice(Fragment.from([block, paragraph.create()]), 0, 1);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

export function handlePaste(
  view: EditorView,
  event: ClipboardEvent,
  h: PasteHandlers
): boolean {
  const data = event.clipboardData;
  if (!data) return false;
  const images = [...data.files].filter(isImage);
  if (images.length) {
    h.onImages(images);
    return true;
  }
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  if (!text) return false;

  const { kind, language } = classifyPaste({
    text,
    html: data.getData("text/html"),
    editorMode: editorMode(data),
  });
  if (kind === "attachment" && !h.asText) {
    h.onLongPaste(text, language);
    return true;
  }
  const { $from } = view.state.selection;
  if ($from.parent.type.spec.code) {
    view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    return true;
  }
  if (h.plain || h.asText || kind === "inline")
    insertDoc(view, textToDoc(text));
  else if (kind === "code")
    insertCode(view, text.replace(/\n+$/, ""), language);
  else insertDoc(view, markdownToDoc(text));
  return true;
}
