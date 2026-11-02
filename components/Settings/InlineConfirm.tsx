"use client";

import { Button } from "@/components/ui/button";

/**
 * The in-app confirm under a row: a message and two buttons, never a browser
 * dialog (which a webview drops). The full-access switch, and every revoke,
 * ask this way.
 */
export function InlineConfirm({
  label,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  // The dialog's accessible name.
  label: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={label}
      className="bg-destructive/10 my-1 space-y-2 rounded-lg px-3 py-2 text-sm"
    >
      <p>{message}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          className="h-11 sm:h-9"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 sm:h-9"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
