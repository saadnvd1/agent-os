"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CodeSearchResults } from "@/components/CodeSearch/CodeSearchResults";

interface CodeSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFile?: (file: string, line: number) => void;
  activeSessionWorkingDir?: string;
}

/** Search the code of the session on show (switching chats is the palette's Sessions tab). */
export function CodeSearchDialog({
  open,
  onOpenChange,
  onSelectFile,
  activeSessionWorkingDir,
}: CodeSearchDialogProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const handleSelectFile = useCallback(
    (file: string, line: number) => {
      onOpenChange(false);
      onSelectFile?.(file, line);
    },
    [onOpenChange, onSelectFile]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search code</DialogTitle>
          <DialogDescription>
            Search the files of this session
          </DialogDescription>
        </DialogHeader>
        <div className="border-border border-b p-3">
          <Input
            ref={inputRef}
            placeholder="Search code (min 3 chars)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto py-2">
          <CodeSearchResults
            workingDirectory={activeSessionWorkingDir || "~"}
            query={query}
            onSelectFile={handleSelectFile}
          />
        </div>
        <div className="border-border text-muted-foreground flex items-center gap-4 border-t px-4 py-2 text-xs">
          <span>
            <kbd className="bg-muted rounded px-1.5 py-0.5">↵</kbd> select
          </span>
          <span>
            <kbd className="bg-muted rounded px-1.5 py-0.5">esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
