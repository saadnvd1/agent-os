"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { FileSuggestion } from "@/lib/chat/events";
import { mentionQuery, mentionText } from "@/lib/chat/mentions";
import type { CaretText } from "./useComposerEditor";

const DEBOUNCE_MS = 80;

// The "@" menu: what's being mentioned at the caret, the files and folders
// it could mean (asked of the agent, through the server), and picking one.
export function useMentions(
  editor: Editor | null,
  caret: CaretText,
  enabled: boolean,
  requestFiles?: (query: string) => Promise<FileSuggestion[]>
) {
  const mention = enabled && requestFiles ? mentionQuery(caret.before) : null;
  const query = mention?.query ?? null;
  const [found, setFound] = useState<{
    query: string;
    files: FileSuggestion[];
  } | null>(null);

  useEffect(() => {
    if (query === null || !requestFiles) return;
    let current = true;
    const timer = setTimeout(() => {
      void requestFiles(query).then((files) => {
        if (current) setFound({ query, files });
      });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, requestFiles]);

  const pick = (file: FileSuggestion) => {
    if (!editor || !mention) return;
    // The "@" and what follows it, up to the caret.
    const from = caret.pos - (caret.before.length - mention.start);
    editor
      .chain()
      .focus()
      .deleteRange({ from, to: caret.pos })
      .insertContent({ type: "text", text: mentionText(file) })
      .run();
  };

  return {
    // The "@" being typed, as typed so far: a menu closed on it opens
    // again with the next keystroke.
    key: mention ? `@${caret.pos}:${caret.before}` : null,
    // The last answer while the next one loads, so the list doesn't flash.
    files: mention ? (found?.files ?? []) : [],
    loading: mention !== null && found?.query !== query,
    pick,
  };
}
