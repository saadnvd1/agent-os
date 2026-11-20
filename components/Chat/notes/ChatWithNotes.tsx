"use client";

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { notesUi, notesUiActions } from "@/stores/notesUi";
import { NotesDrawer } from "./NotesDrawer";

// A chat with its notes drawer: on a desktop the chat narrows beside it, on
// a phone the notes take the screen until closed.
export function ChatWithNotes({
  sessionId,
  mobile,
  active,
  children,
}: {
  sessionId: string;
  mobile: boolean;
  // Only the tab on show opens its notes.
  active: boolean;
  children: React.ReactNode;
}) {
  const { open, sheetOpen } = useSnapshot(notesUi);
  useEffect(() => notesUiActions.hydrate(), []);
  const shown = active && (mobile ? sheetOpen : open);
  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="h-full min-w-0 flex-1">{children}</div>
      {shown && <NotesDrawer sessionId={sessionId} mobile={mobile} />}
    </div>
  );
}
