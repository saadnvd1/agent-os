"use client";

import { useEffect } from "react";
import { draftKeyFor } from "@/lib/drafts";
import { newDraft } from "@/stores/drafts";

// ⌘N, ⌘⇧N and ⌘⌥N open a draft from anywhere in the app (Ctrl off a Mac,
// except in a terminal, where Ctrl+N belongs to the shell).
export function useDraftKeys() {
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const onKey = (e: KeyboardEvent) => {
      if (!mac && (e.target as Element | null)?.closest?.(".xterm")) return;
      const kind = draftKeyFor({
        code: e.code,
        mod: mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      if (!kind) return;
      e.preventDefault();
      newDraft({ kind });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
