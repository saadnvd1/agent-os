"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ArtifactFrame } from "@/components/Chat/ArtifactFrame";
import { ICON_BUTTON } from "./ArtifactActions";

// A rendered page over the whole screen, its actions in the bar.
export function ArtifactFullscreen({
  open,
  onOpenChange,
  artifactId,
  src,
  title,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactId: string;
  src?: string;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:max-w-none"
      >
        <div className="flex items-center gap-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))] pr-1 pl-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </DialogTitle>
          {actions}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={ICON_BUTTON}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
          {open && (
            <ArtifactFrame
              artifactId={artifactId}
              src={src}
              title={title}
              fill
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
