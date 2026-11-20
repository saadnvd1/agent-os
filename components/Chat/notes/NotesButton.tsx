"use client";

import { NotebookPen } from "lucide-react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import { useSessionNote } from "@/data/notes";
import { noteIsEmpty } from "@/lib/notes/isEmpty";
import { notesUi, notesUiActions } from "@/stores/notesUi";

export function useHasNote(sessionId: string): boolean {
  const { data } = useSessionNote(sessionId);
  return !noteIsEmpty(data?.doc);
}

// The notebook, with a dot once the session has a note.
export function NotesIcon({ has }: { has: boolean }) {
  return (
    <span className="relative flex">
      <NotebookPen className="h-3.5 w-3.5" />
      {has && (
        <span
          aria-hidden
          className="bg-primary ring-background absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full ring-2"
        />
      )}
    </span>
  );
}

// The phone bar's Notes toggle; the desktop's sits in the view toggle.
export function NotesButton({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { sheetOpen } = useSnapshot(notesUi);
  const has = useHasNote(sessionId);
  return (
    <button
      type="button"
      aria-label={has ? "Notes (has notes)" : "Notes"}
      aria-pressed={sheetOpen}
      title="Notes"
      onClick={(e) => {
        e.stopPropagation();
        notesUiActions.toggle(true);
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-accent flex shrink-0 items-center justify-center rounded-md",
        sheetOpen && "bg-accent text-foreground",
        className
      )}
    >
      <NotesIcon has={has} />
    </button>
  );
}
