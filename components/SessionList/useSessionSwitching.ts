"use client";

import { MessageSquare } from "lucide-react";
import { useKeybindings } from "@/hooks/useKeybindings";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import { chordHint } from "@/lib/keybindings/chord";
import { fieldOwnsKey } from "@/lib/keybindings/focus";
import { neighbourSession } from "@/lib/sidebar/visible-order";

const PREVIOUS = "mod+up";
const NEXT = "mod+down";

// ⌘↑ / ⌘↓ (Ctrl off a Mac) select the row above or below the active one, as
// a click would, in the order the sidebar shows. Nothing happens at either end.
export function useSessionSwitching(
  orderedIds: string[],
  activeSessionId: string | undefined,
  onSelect: (id: string) => void
) {
  const step = (by: 1 | -1) => {
    const id = neighbourSession(orderedIds, activeSessionId, by);
    if (!id) return;
    onSelect(id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-session-row="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    );
  };
  const free = (e: KeyboardEvent) => !fieldOwnsKey(e.target);
  useKeybindings("session-switching", [
    { id: "session.previous", keys: PREVIOUS, when: free, run: () => step(-1) },
    { id: "session.next", keys: NEXT, when: free, run: () => step(1) },
  ]);
  usePaletteCommands("session-switching", [
    {
      id: "session.previous",
      title: "Previous session",
      group: "Actions",
      hint: chordHint(PREVIOUS),
      keywords: ["switch", "up"],
      icon: MessageSquare,
      run: () => step(-1),
    },
    {
      id: "session.next",
      title: "Next session",
      group: "Actions",
      hint: chordHint(NEXT),
      keywords: ["switch", "down"],
      icon: MessageSquare,
      run: () => step(1),
    },
  ]);
}
