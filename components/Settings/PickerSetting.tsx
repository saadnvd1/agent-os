"use client";

import type { ReactNode } from "react";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SettingRow } from "./SettingRow";

/**
 * A setting whose control is a picker of your own (a model list, say): the
 * row, the instant save, rollback with a toast, Saved and Reset come from
 * here. `render` gets the value to show and a `commit` that saves a new one.
 */
export function PickerSetting<T>({
  id,
  label,
  help,
  value,
  onSave,
  defaultValue,
  hint,
  error,
  resetLabel,
  render,
  below,
}: {
  id: string;
  label: string;
  help?: string;
  value: T;
  onSave: (next: T) => Promise<unknown>;
  // Reset shows while the value differs from this.
  defaultValue?: T;
  hint?: string;
  error?: string | null;
  // What Reset goes back to, in words.
  resetLabel?: string;
  render: (picker: { value: T; commit: (next: T) => void }) => ReactNode;
  below?: ReactNode;
}) {
  const auto = useAutoSave({ saved: value, save: onSave });
  return (
    <SettingRow
      id={id}
      label={label}
      help={help}
      hint={hint}
      error={error ?? auto.error}
      resetLabel={resetLabel}
      status={auto.status}
      onUndo={auto.undo}
      onReset={
        defaultValue !== undefined && auto.value !== defaultValue
          ? () => void auto.commit(defaultValue, { undoable: true })
          : undefined
      }
      control={
        <div className="w-60 max-w-full max-sm:w-full">
          {render({ value: auto.value, commit: (v) => void auto.commit(v) })}
        </div>
      }
      below={below}
    />
  );
}
