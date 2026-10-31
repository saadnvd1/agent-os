"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

// Where the phone layout ends and the desktop popover begins.
export const PICKER_DESKTOP = "(min-width: 768px)";

/** A bottom sheet on a phone, a dialog on a desktop. */
export function PickerSheet({
  open,
  onOpenChange,
  title,
  onKeyDown,
  onOpened,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onKeyDown?: React.KeyboardEventHandler;
  // Desktop only: a phone keeps the keyboard down until asked.
  onOpened?: () => void;
  children: ReactNode;
}) {
  const desktop = useMediaQuery(PICKER_DESKTOP);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        placement={desktop ? "center" : "sheet"}
        aria-describedby={undefined}
        aria-label={title}
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (desktop) onOpened?.();
        }}
        className={cn(
          "gap-0 overflow-hidden p-0",
          desktop ? "h-[440px] max-w-[620px] sm:max-w-[620px]" : "h-[86dvh]"
        )}
      >
        <div className="flex h-12 shrink-0 items-center justify-between px-4 md:hidden">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogPrimitive.Close
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground -mr-2 grid h-11 w-11 place-items-center rounded-lg"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
