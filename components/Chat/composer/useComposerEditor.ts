"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { docToMarkdown } from "@/lib/chat/markdown/serialize";
import { plainExtensions, richExtensions } from "./extensions";
import { loadMarkdown } from "./load";
import { handleKeyDown, type KeyHandlers } from "./keys";
import { handlePaste, isImage, type PasteHandlers } from "./paste";
import { usePlainMode } from "./usePlainMode";

export type ComposerHandlers = Omit<
  KeyHandlers,
  "plain" | "onTogglePlain" | "onPasteAsText"
> &
  Omit<PasteHandlers, "plain" | "asText">;

const PASTE_AS_TEXT_WINDOW = 1000;

// The composer's TipTap editor. It holds markdown: `text` is what gets sent,
// and setText puts markdown back in (a draft, an undone message, a command).
// The text of the line the caret is in, up to the caret: what an @mention
// is read from.
export interface CaretText {
  before: string;
  pos: number;
}

const caretText = (ed: Editor): CaretText => {
  const { $from, empty } = ed.state.selection;
  return {
    before: empty
      ? $from.parent.textBetween(0, $from.parentOffset, undefined, "\n")
      : "",
    pos: $from.pos,
  };
};

export function useComposerEditor({
  placeholder,
  ghost,
  disabled,
  handlers,
}: {
  placeholder: string;
  // Ghost text in place of the placeholder: the agent's suggestion.
  ghost?: string | null;
  disabled?: boolean;
  // Read at keypress and paste time, so they always see the latest state.
  handlers: RefObject<ComposerHandlers | null>;
}) {
  // The composer is only mounted once the mode is known (see Composer).
  const [stored, setPlain] = usePlainMode();
  const plain = stored ?? false;
  const [text, setTextState] = useState("");
  const [caret, setCaret] = useState<CaretText>({ before: "", pos: 0 });
  const pasteAsTextUntil = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const placeholderRef = useRef(ghost || placeholder);
  useEffect(() => {
    placeholderRef.current = ghost || placeholder;
    editorRef.current?.view.dispatch(editorRef.current.state.tr);
  }, [placeholder, ghost]);
  const plainRef = useRef(plain);
  useEffect(() => {
    plainRef.current = plain;
  }, [plain]);

  const extensions = useMemo(
    () =>
      plain
        ? plainExtensions(() => placeholderRef.current)
        : richExtensions(() => placeholderRef.current),
    [plain]
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
      enablePasteRules: false,
      extensions,
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
      // Only edits change the text: not loading a draft, not setEditable.
      onUpdate: ({ editor: ed, transaction }) => {
        if (!transaction.docChanged) return;
        setTextState(docToMarkdown(ed.getJSON()));
        setCaret(caretText(ed));
      },
      onSelectionUpdate: ({ editor: ed }) => setCaret(caretText(ed)),
    },
    [plain]
  );
  // A new editor (first mount, or plain mode toggled) starts from the text so far.
  useEffect(() => {
    if (!editor) return;
    const replacing = editorRef.current !== null;
    editorRef.current = editor;
    loadMarkdown(editor, text, plain);
    // Toggling plain mode swaps editors under the cursor: keep typing there.
    if (replacing) editor.commands.focus("end");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  const setText = useCallback(
    (md: string, focus = false) => {
      setTextState(md);
      if (!editor) return;
      loadMarkdown(editor, md, plain);
      if (focus) editor.commands.focus("end");
    },
    [editor, plain]
  );

  return { editor, text, setText, caret, plain, setPlain };
}
