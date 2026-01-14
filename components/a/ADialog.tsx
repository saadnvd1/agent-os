/**
 * ADialog - Reusable dialog component for the design system
 *
 * A modal dialog with optional icon, header, scrollable content, and footer.
 *
 * @example
 * ```tsx
 * <ADialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   title="Settings"
 *   description="Manage your preferences"
 *   icon={<Settings />}
 *   footer={<Button>Save</Button>}
 * >
 *   <SettingsContent />
 * </ADialog>
 * ```
 */

"use client";

import { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ADialogProps {
  /** Controlled open state */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Dialog title */
  title: string;
  /** Optional description below the title */
  description?: string;
  /** Optional icon to show next to title */
  icon?: ReactNode;
  /** Main content */
  children: ReactNode;
  /** Optional footer content (typically action buttons) */
  footer?: ReactNode;
  /** Maximum width class (default: "sm:max-w-lg") */
  maxWidth?: string;
  /** Additional className for the dialog content */
  className?: string;
  /** Additional className for the content container */
  contentClassName?: string;
}

export function ADialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  maxWidth = "sm:max-w-lg",
  className,
  contentClassName,
}: ADialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(maxWidth, className)}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            {icon && (
              <span className="text-foreground [&>svg]:h-5 [&>svg]:w-5">
                {icon}
              </span>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className={cn("py-4", contentClassName)}>{children}</div>

        {footer && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
