"use client";

import { useEffect, useRef } from "react";
import type { ChatImage } from "@/lib/chat/events";
import type { TextAttachment } from "@/lib/chat/paste";

// `text` is the composer's markdown, so a reload restores its formatting.
interface Draft {
  text: string;
  images: ChatImage[];
  files?: TextAttachment[];
}

const keyFor = (id: string) => `agentos:draft:${id}`;

export function loadDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(keyFor(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

// Keeps what's typed in a session's composer across reloads, in this
// browser. Images and long pastes are kept too while they fit; text always is.
export function useSaveDraft(id: string | undefined, draft: Draft): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const key = keyFor(id);
      if (!draft.text.trim() && !draft.images.length && !draft.files?.length) {
        localStorage.removeItem(key);
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        // Over quota: drop images, then long pastes, and keep the words.
        for (const smaller of [
          { ...draft, images: [] },
          { ...draft, images: [], files: [] },
        ]) {
          try {
            localStorage.setItem(key, JSON.stringify(smaller));
            return;
          } catch {
            // Still too big, or storage unavailable.
          }
        }
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [id, draft]);
}
