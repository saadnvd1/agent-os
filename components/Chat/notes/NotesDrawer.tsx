"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { GenericSkeletonLoader } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useSessionNote } from "@/data/notes";
import { notesUi, notesUiActions } from "@/stores/notesUi";
import { NotesEditor } from "./NotesEditor";
import type { SaveState } from "./autosave";

const STATE_LABEL: Partial<Record<SaveState, string>> = {
  pending: "Editing",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved, retrying on next edit",
};

function NotesBody({
  sessionId,
  mobile,
}: {
  sessionId: string;
  mobile: boolean;
}) {
  // Read again on every open: another device may have changed it.
  const note = useSessionNote(sessionId, { fresh: true });
  const [state, setState] = useState<SaveState>("idle");
  const ready = note.isFetchedAfterMount || note.isError;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <h2 className="text-sm font-medium">Notes</h2>
        <span
          role="status"
          className={cn(
            "text-muted-foreground text-xs",
            state === "error" && "text-destructive"
          )}
        >
          {note.isError ? "Couldn't load notes" : (STATE_LABEL[state] ?? "")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close notes"
          className="ml-auto h-11 w-11 md:h-8 md:w-8"
          onClick={() => notesUiActions.close(mobile)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {ready && !note.isError ? (
        <NotesEditor
          key={sessionId}
          sessionId={sessionId}
          initial={note.data?.doc ?? null}
          onState={setState}
        />
      ) : !note.isError ? (
        <GenericSkeletonLoader className="p-4" />
      ) : null}
    </div>
  );
}

// Desktop: a column beside the chat, its left edge dragged to resize.
function DesktopDrawer({ sessionId }: { sessionId: string }) {
  const { width } = useSnapshot(notesUi);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: notesUi.width };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    notesUiActions.setWidth(drag.current.w + drag.current.x - e.clientX);
  }, []);
  const end = useCallback(() => {
    drag.current = null;
  }, []);
  return (
    <aside
      aria-label="Session notes"
      style={{ width }}
      className="bg-card relative flex h-full max-w-[60%] shrink-0 flex-col border-l"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => notesUiActions.setWidth(360)}
        className="hover:bg-primary/30 active:bg-primary/50 absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors"
      />
      <NotesBody sessionId={sessionId} mobile={false} />
    </aside>
  );
}

// Phone: a full-screen sheet over the chat, with its own close.
function MobileSheet({ sessionId }: { sessionId: string }) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session notes"
      className="bg-background fixed inset-0 z-50 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <NotesBody sessionId={sessionId} mobile />
    </div>,
    document.body
  );
}

export function NotesDrawer({
  sessionId,
  mobile,
}: {
  sessionId: string;
  mobile: boolean;
}) {
  return mobile ? (
    <MobileSheet sessionId={sessionId} />
  ) : (
    <DesktopDrawer sessionId={sessionId} />
  );
}
