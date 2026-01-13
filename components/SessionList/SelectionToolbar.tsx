"use client";

import { useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, X, CheckSquare } from "lucide-react";
import { useSessionMultiSelect } from "@/contexts/SessionMultiSelectContext";
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

export function SelectionToolbar({ allSessionIds, onDeleteSessions }: SelectionToolbarProps) {
  const multiSelect = useSessionMultiSelect();
  const selectedCount = multiSelect.getSelectedCount();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelectAll = useCallback(() => {
    multiSelect.selectAll(allSessionIds);
  }, [multiSelect, allSessionIds]);

  const handleDelete = useCallback(async () => {
    const selectedIds = multiSelect.getSelectedSessionIds();
    if (selectedIds.length === 0) return;

    setIsDeleting(true);
    try {
      await onDeleteSessions(selectedIds);
      multiSelect.clearSelection();
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  }, [multiSelect, onDeleteSessions]);

  // Keyboard shortcuts
  useEffect(() => {
    if (selectedCount === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete key - show delete confirmation
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't trigger if typing in an input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
        setShowDeleteDialog(true);
      }

      // Escape - clear selection
      if (e.key === "Escape") {
        e.preventDefault();
        multiSelect.clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCount, multiSelect]);

  if (selectedCount === 0) return null;

  const allSelected = selectedCount === allSessionIds.length;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2 bg-primary/10 border-b border-primary/20">
        <span className="text-sm font-medium whitespace-nowrap">
          {selectedCount} selected
        </span>
        <div className="flex items-center gap-1 ml-auto">
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
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            onClick={multiSelect.clearSelection}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete {selectedCount} session{selectedCount > 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the selected sessions and their tmux sessions.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>
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
