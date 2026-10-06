"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { docToMarkdown } from "@/lib/chat/markdown/serialize";
import { markdownToDoc, textToDoc } from "@/lib/chat/markdown/parse";
import { plainExtensions, richExtensions } from "./extensions";
import { handleKeyDown, type KeyHandlers } from "./keys";
import { handlePaste, isImage, type PasteHandlers } from "./paste";
import { usePlainMode } from "./usePlainMode";

export type ComposerHandlers = Omit<
  KeyHandlers,
  "plain" | "onTogglePlain" | "onPasteAsText"
> &
  Omit<PasteHandlers, "plain" | "asText">;

const PASTE_AS_TEXT_WINDOW = 1000;

const toDoc = (md: string, plain: boolean) =>
  plain ? textToDoc(md) : markdownToDoc(md);

// The composer's TipTap editor. It holds markdown: `text` is what gets sent,
// and setText puts markdown back in (a draft, an undone message, a command).
export function useComposerEditor({
  placeholder,
  disabled,
  handlers,
}: {
  placeholder: string;
  disabled?: boolean;
  // Read at keypress and paste time, so they always see the latest state.
  handlers: RefObject<ComposerHandlers | null>;
}) {
  const [plain, setPlain] = usePlainMode();
  const [text, setTextState] = useState("");
  const pasteAsTextUntil = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const placeholderRef = useRef(placeholder);
  useEffect(() => {
    placeholderRef.current = placeholder;
    editorRef.current?.view.dispatch(editorRef.current.state.tr);
  }, [placeholder]);
  const plainRef = useRef(plain);
  useEffect(() => {
    plainRef.current = plain;
  }, [plain]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      enablePasteRules: false,
      extensions: plain
        ? plainExtensions(() => placeholderRef.current)
        : richExtensions(() => placeholderRef.current),
      editable: !disabled,
      editorProps: {
        attributes: {
          "aria-label": "Message",
          "aria-multiline": "true",
          role: "textbox",
          autocorrect: "on",
          autocapitalize: "sentences",
          spellcheck: "true",
          class: "min-h-10 w-full px-2 py-2 text-base outline-none md:text-sm",
        },
        handleKeyDown: (view, event) => {
          const ed = editorRef.current;
          if (!ed || !handlers.current) return false;
          return handleKeyDown(ed, event, {
            ...handlers.current,
            plain: plainRef.current,
            onTogglePlain: () => setPlain(!plainRef.current),
            onPasteAsText: () => {
              pasteAsTextUntil.current = Date.now() + PASTE_AS_TEXT_WINDOW;
            },
          });
        },
        handlePaste: (view, event) => {
          if (!handlers.current) return false;
          const asText = Date.now() <= pasteAsTextUntil.current;
          pasteAsTextUntil.current = 0;
          return handlePaste(view, event, {
            ...handlers.current,
            plain: plainRef.current,
            asText,
          });
        },
        // Dropped images are the composer's to take, not the document's.
        handleDrop: (view, event) =>
          [...(event.dataTransfer?.files ?? [])].some(isImage),
      },
      onUpdate: ({ editor: ed }) => {
        const md = docToMarkdown(ed.getJSON());
        setTextState(md);
      },
    },
    [plain]
  );
  // A new editor (first mount, or plain mode toggled) starts from the text so far.
  useEffect(() => {
    if (!editor) return;
    const replacing = editorRef.current !== null;
    editorRef.current = editor;
    editor.commands.setContent(toDoc(text, plain), { emitUpdate: false });
    // Toggling plain mode swaps editors under the cursor: keep typing there.
    if (replacing) editor.commands.focus("end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const setText = useCallback(
    (md: string, focus = false) => {
      setTextState(md);
      if (!editor) return;
      editor.commands.setContent(toDoc(md, plain), { emitUpdate: false });
      if (focus) editor.commands.focus("end");
    },
    [editor, plain]
  );

  return { editor, text, setText, plain, setPlain };
}
