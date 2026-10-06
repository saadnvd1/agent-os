"use client";

import { useEffect, useRef } from "react";
import type { ChatImage } from "@/lib/chat/events";

interface Draft {
  text: string;
  images: ChatImage[];
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
// browser. Images are kept too while they fit; text always is.
export function useSaveDraft(id: string | undefined, draft: Draft): void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const key = keyFor(id);
      if (!draft.text.trim() && !draft.images.length) {
        localStorage.removeItem(key);
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        // Over quota with images: keep the words.
        try {
          localStorage.setItem(key, JSON.stringify({ ...draft, images: [] }));
        } catch {
          // Storage unavailable.
        }
      }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [id, draft]);
}
