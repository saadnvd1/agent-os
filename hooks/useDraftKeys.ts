"use client";

import { useEffect } from "react";
import { draftKeyFor } from "@/lib/drafts";
import { newDraft } from "@/stores/drafts";

// ⌥N, ⌥⇧N and ⌃⌥N (or ⌘N and friends where the browser passes them) open a
// draft from anywhere in the app; off a Mac, never inside a terminal.
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
        ctrlKey: e.ctrlKey,
      });
      if (!kind) return;
      e.preventDefault();
      newDraft({ kind });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
