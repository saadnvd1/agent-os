"use client";

import { useEffect, useCallback, useState } from "react";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { Trash2, X } from "lucide-react";
import { selectionStore, selectionActions } from "@/stores/sessionSelection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SelectionToolbarProps {
  allSessionIds: string[];
  onDeleteSessions: (sessionIds: string[]) => Promise<void>;
}

export function SelectionToolbar({
  allSessionIds,
  onDeleteSessions,
}: SelectionToolbarProps) {
  const { selectedIds } = useSnapshot(selectionStore);
  const selectedCount = selectedIds.size;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelectAll = useCallback(() => {
    selectionActions.selectAll(allSessionIds);
  }, [allSessionIds]);

  const handleDelete = useCallback(async () => {
    const ids = selectionActions.getSelectedIds();
    if (ids.length === 0) return;

    setIsDeleting(true);
    try {
      await onDeleteSessions(ids);
      selectionActions.clear();
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  }, [onDeleteSessions]);

  // Keyboard shortcuts
  useEffect(() => {
    if (selectedCount === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete key - show delete confirmation
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't trigger if typing in an input
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        e.preventDefault();
        setShowDeleteDialog(true);
      }

      // Escape - clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        selectionActions.clear();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  const allSelected = selectedCount === allSessionIds.length;

  return (
    <>
      <div className="bg-primary/10 border-primary/20 flex items-center gap-3 border-b px-4 py-2">
        <span className="text-sm font-medium whitespace-nowrap">
          {selectedCount} selected
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!allSelected && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSelectAll}
            >
              Select all
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            onClick={selectionActions.clear}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedCount} session{selectedCount > 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the selected sessions and their tmux
              sessions. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
