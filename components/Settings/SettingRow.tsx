"use client";

import { Check, Loader2 } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import type { SaveStatus } from "@/hooks/useAutoSave";
import { cn } from "@/lib/utils";

// What the Settings search box holds; a row that doesn't match hides.
export const SettingsQueryContext = createContext("");

/**
 * One setting on a Settings page, 44px at least: label and one-line help on
 * the left, the control on the right (below the label on a phone), and a meta
 * line for the default hint or the error, "Saved", Undo and Reset. Every
 * variant (settings-fields) renders through this.
 */
export function SettingRow({
  id,
  label,
  help,
  control,
  controlClassName,
  hint,
  error,
  status = "idle",
  onUndo,
  onReset,
  below,
}: {
  id: string;
  label: string;
  help?: string;
  control: ReactNode;
  controlClassName?: string;
  hint?: string;
  error?: string | null;
  status?: SaveStatus;
  onUndo?: () => void;
  // Given only while the value differs from the default.
  onReset?: () => void;
  below?: ReactNode;
}) {
  const query = useContext(SettingsQueryContext).trim().toLowerCase();
  const haystack = `${label} ${help ?? ""}`.toLowerCase();
  if (query && !query.split(/\s+/).every((w) => haystack.includes(w)))
    return null;
  return (
    <div
      data-setting={id}
      className="border-foreground/5 grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-t px-3 py-2 first:border-t-0"
    >
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {help && (
          <p className="text-muted-foreground text-xs leading-snug">{help}</p>
        )}
      </div>
      <div
        className={cn(
          "flex min-w-0 items-center justify-end gap-2 max-sm:col-span-2 max-sm:row-start-2 max-sm:mt-1 max-sm:justify-start",
          controlClassName
        )}
      >
        {control}
      </div>
      <div className="text-muted-foreground col-span-2 flex min-h-5 items-center justify-between gap-2 text-xs">
        <span
          id={`${id}-hint`}
          className={cn("min-w-0", error && "text-destructive")}
          role={error ? "alert" : undefined}
        >
          {error ?? hint}
        </span>
        <span className="flex shrink-0 items-center gap-3" aria-live="polite">
          {status === "saving" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </span>
          )}
          {(status === "saved" || status === "undo") && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" />
              Saved
            </span>
          )}
          {status === "undo" && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="text-primary -my-3 -mr-1 min-h-11 px-1 hover:underline"
            >
              Undo
            </button>
          )}
          {onReset && status !== "undo" && (
            <button
              type="button"
              onClick={onReset}
              className="text-primary -my-3 -mr-1 min-h-11 px-1 hover:underline"
            >
              Reset
            </button>
          )}
        </span>
      </div>
      {below && <div className="col-span-2">{below}</div>}
    </div>
  );
}

/** A titled group of rows with one line of help. */
export function SettingSection({
  title,
  help,
  children,
}: {
  title?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 [&:not(:has([data-setting]))]:hidden">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {help && <p className="text-muted-foreground mb-2 text-xs">{help}</p>}
      <div className="bg-muted/40 overflow-hidden rounded-xl">{children}</div>
    </section>
  );
}
