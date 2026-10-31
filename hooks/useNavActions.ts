"use client";

import { Keyboard, MessageSquare, Repeat } from "lucide-react";
import type { Session } from "@/lib/db";
import { chordHint } from "@/lib/keybindings/chord";
import { keysOf } from "@/lib/keybindings/keymap";
import { previousChatId } from "@/lib/nav/recent";
import { useNavKeys, useSingleKeys } from "@/hooks/useNavKeys";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import { bookmarksUiActions } from "@/stores/bookmarksUi";
import { chatOpened } from "@/stores/chatPositions";
import { newDraft } from "@/stores/drafts";
import { inboxUiActions } from "@/stores/inboxUi";
import { paletteActions, paletteUi } from "@/stores/palette";
import { settingsUiActions } from "@/stores/settingsUi";
import { shortcutsUiActions } from "@/stores/shortcutsUi";

/** The chats ⌘P, O C and the like switch between, as the palette's Sessions tab. */
function openSwitcher() {
  if (paletteUi.open && paletteUi.tab === "sessions")
    return paletteActions.setOpen(false);
  paletteActions.open();
  paletteActions.setTab("sessions");
}

/**
 * What each shortcut in keymap.ts does, and the palette commands that go
 * with them. Opening a chat goes through `select`, so history, position and
 * the address follow as they do for a click.
 */
export function useNavActions({
  sessions,
  activeSessionId,
  select,
}: {
  sessions: Session[];
  activeSessionId: string | null | undefined;
  select: (session: Session) => void;
}) {
  const [singles, setSingles] = useSingleKeys();
  const previous = () => {
    const open = sessions.filter((s) => !s.archived_at);
    const id = previousChatId(
      open.map((s) => s.id),
      chatOpened,
      activeSessionId
    );
    const session = open.find((s) => s.id === id);
    if (session) select(session);
  };
  const actions = {
    "palette.open": () =>
      paletteUi.open ? paletteActions.setOpen(false) : paletteActions.open(),
    "switcher.open": openSwitcher,
    "chat.open": openSwitcher,
    "chat.previous": previous,
    "chat.new": () => newDraft({ kind: "current" }),
    "go.inbox": () => inboxUiActions.open(),
    "go.messages": () => inboxUiActions.open("messages"),
    "go.bookmarks": () => bookmarksUiActions.open(activeSessionId ?? null),
    "go.settings": () => settingsUiActions.open(),
    "help.open": shortcutsUiActions.open,
  };
  useNavKeys(actions);
  usePaletteCommands("nav", [
    {
      id: "nav.switch",
      title: "Switch chat",
      group: "Go to",
      hint: chordHint(keysOf("switcher.open")),
      keywords: ["recent", "open chat", "session", "switcher"],
      icon: MessageSquare,
      run: openSwitcher,
    },
    {
      id: "nav.previous",
      title: "Previous chat",
      group: "Go to",
      hint: "G P",
      keywords: ["flip", "alternate", "last", "back"],
      icon: Repeat,
      run: previous,
    },
    {
      id: "nav.shortcuts",
      title: "Keyboard shortcuts",
      group: "Go to",
      hint: "?",
      keywords: ["keys", "help", "hotkeys"],
      icon: Keyboard,
      run: shortcutsUiActions.open,
    },
    {
      id: "nav.single-keys",
      title: singles
        ? "Turn off single-key shortcuts"
        : "Turn on single-key shortcuts",
      group: "Settings",
      keywords: ["keyboard", "letters", "vim", "linear"],
      icon: Keyboard,
      run: () => setSingles(!singles),
    },
  ]);
}
