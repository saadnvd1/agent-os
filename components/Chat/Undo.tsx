"use client";

import { ChevronRight, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UndoPreview } from "@/lib/chat/events";
import type { UndoItem } from "@/lib/chat/group";
import { shortPath } from "@/lib/chat/diff";
import { cn } from "@/lib/utils";
import { useRowState } from "./rowState";

const counts = (p: { insertions?: number; deletions?: number }) =>
  p.insertions || p.deletions
    ? ` (+${p.insertions ?? 0} −${p.deletions ?? 0})`
    : "";

// Confirms an undo, showing which files go back before anything moves.
export function UndoDialog({
  preview,
  onConfirm,
  onClose,
}: {
  preview: UndoPreview | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const files = preview?.files ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Undo from this message?</DialogTitle>
          <DialogDescription>
            The conversation goes back to before it, and the message returns to
            the composer to edit and send again.
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking files…
          </p>
        ) : preview.error ? (
          <p className="text-destructive text-sm">{preview.error}</p>
        ) : files.length ? (
          <div className="space-y-1 text-sm">
            <p>
              Restores {files.length} file{files.length === 1 ? "" : "s"}
              {counts(preview)}:
            </p>
            <ul className="text-muted-foreground max-h-40 overflow-auto font-mono text-xs">
              {files.map((f) => (
                <li key={f}>{shortPath(f)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No file edits to restore since this message.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Edits the agent made with its file tools are restored. Changes made by
          shell commands are not.
        </p>
        <DialogFooter>
          <Button variant="ghost" className="h-11 md:h-9" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={!preview?.canUndo}
            onClick={onConfirm}
          >
            Undo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UndoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Undo from here"
      title="Undo from here"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-9 w-9 items-center justify-center rounded-md opacity-60 group-hover:opacity-100 md:h-7 md:w-7 md:opacity-0"
    >
      <Undo2 className="h-3.5 w-3.5" />
    </button>
  );
}

// Messages an undo took back: one quiet line, expandable to read them.
export function UndoneBlock({
  undo,
  count,
  children,
}: {
  undo: UndoItem;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useRowState(`undone:${undo.id}`, false);
  const files = undo.filesChanged
    ? ` · restored ${undo.filesChanged} file${undo.filesChanged === 1 ? "" : "s"}${counts(undo)}`
    : "";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-muted-foreground/70 hover:text-foreground flex min-h-9 w-full items-center gap-2 font-mono text-[11px]"
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
        <Undo2 className="h-3 w-3" />
        Undid {count} message{count === 1 ? "" : "s"}
        {files}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-4 opacity-50">{children}</div>
      )}
    </div>
  );
}
