"use client";

import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useQueryClient } from "@tanstack/react-query";
import { notesExtensions } from "@/components/Chat/composer/extensions";
import {
  handlePaste,
  insertCode,
  insertDoc,
} from "@/components/Chat/composer/paste";
import { markdownToDoc } from "@/lib/chat/markdown/parse";
import { saveSessionNote, type NoteDoc } from "@/data/notes";
import { createAutosaver, type SaveState } from "./autosave";

const PLACEHOLDER = "Scratch notes for this session…";

// One session's note. Mounted per session, so switching saves the last one
// on the way out and starts from the server's copy of the next.
export function NotesEditor({
  sessionId,
  initial,
  onState,
}: {
  sessionId: string;
  initial: NoteDoc | null;
  // Stable (a state setter): the saver keeps the first one.
  onState: (state: SaveState) => void;
}) {
  const client = useQueryClient();
  const [saver] = useState(() =>
    createAutosaver<NoteDoc>({
      save: (doc) => saveSessionNote(client, sessionId, doc),
      onState,
    })
  );

  useEffect(() => {
    const leave = () => void saver.flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      // Unmounting (close, another session) saves what is left. Nothing
      // else to tear down, so React's dev remount loses nothing.
      void saver.flush();
    };
  }, [saver]);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: notesExtensions(() => PLACEHOLDER),
    content: (initial as JSONContent | null) ?? undefined,
    editorProps: {
      attributes: {
        "aria-label": "Session notes",
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: "true",
        class:
          "min-h-full w-full px-4 py-3 text-base leading-relaxed outline-none md:text-sm",
      },
      // The composer's paste: markdown becomes lists and code, code from an
      // editor a code block. A long paste goes in rather than attaching.
      handlePaste: (view, event) =>
        handlePaste(view, event, {
          plain: false,
          asText: false,
          onFiles: () => {},
          onLongPaste: (text, language) =>
            language
              ? insertCode(view, text, language)
              : insertDoc(view, markdownToDoc(text)),
        }),
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (transaction.docChanged) saver.change(ed.getJSON() as NoteDoc);
    },
    onBlur: () => void saver.flush(),
  });

  return (
    <EditorContent
      editor={editor}
      className="chat-composer session-notes min-h-0 flex-1 overflow-y-auto overscroll-y-contain"
    />
  );
}
