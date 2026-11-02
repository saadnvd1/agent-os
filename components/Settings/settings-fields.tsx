"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAutoSave } from "@/hooks/useAutoSave";
import { parseSettingNumber } from "@/lib/settings/parse";
import { SettingRow } from "./SettingRow";

type Save<T> = (next: T) => Promise<unknown>;

const FIELD = "h-11 text-base md:h-9 md:text-sm";

/** A switch: saves at once. `confirm` makes turning it ON ask first. */
export function SwitchSetting({
  id,
  label,
  help,
  checked,
  onSave,
  defaultValue,
  confirm,
  confirmLabel = "Turn on",
  undoable,
}: {
  id: string;
  label: string;
  help?: string;
  checked: boolean;
  onSave: Save<boolean>;
  defaultValue?: boolean;
  confirm?: string;
  confirmLabel?: string;
  undoable?: boolean;
}) {
  const auto = useAutoSave({ saved: checked, save: onSave });
  const [asking, setAsking] = useState(false);
  return (
    <SettingRow
      id={id}
      label={label}
      help={help}
      status={auto.status}
      onUndo={auto.undo}
      hint={
        defaultValue === undefined
          ? undefined
          : `default ${defaultValue ? "on" : "off"}`
      }
      onReset={
        defaultValue !== undefined && auto.value !== defaultValue
          ? () => void auto.commit(defaultValue, { undoable: true })
          : undefined
      }
      controlClassName="max-sm:col-span-1 max-sm:row-start-1 max-sm:mt-0"
      control={
        <Switch
          id={id}
          checked={auto.value}
          aria-describedby={`${id}-hint`}
          className="data-[state=checked]:bg-primary"
          onCheckedChange={(on) => {
            if (on && confirm) setAsking(true);
            else void auto.commit(on, { undoable: undoable || !on });
          }}
        />
      }
      below={
        asking && (
          <div
            role="alertdialog"
            aria-label={`Turn on ${label}`}
            className="bg-destructive/10 my-1 space-y-2 rounded-lg px-3 py-2 text-sm"
          >
            <p>{confirm}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="h-11 sm:h-9"
                onClick={() => {
                  setAsking(false);
                  void auto.commit(true, { undoable: true });
                }}
              >
                {confirmLabel}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-11 sm:h-9"
                onClick={() => setAsking(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )
      }
    />
  );
}

/**
 * A number, saved on blur or Enter. Esc reverts; a bad value stays in the
 * field with a message and nothing is sent. `scale` converts the stored value
 * to what's typed (tokens to k). With `optional`, a switch turns it off
 * (`off`) or on (`on`) and the input greys out, keeping its number.
 */
export function NumberSetting({
  id,
  label,
  help,
  value,
  onSave,
  defaultValue,
  min,
  max,
  integer = true,
  unit,
  short = "",
  scale = 1,
  optional,
  emptyResets,
}: {
  id: string;
  label: string;
  help?: string;
  value: number;
  onSave: Save<number>;
  defaultValue: number;
  min: number;
  max?: number;
  integer?: boolean;
  unit?: string;
  // The unit as it follows a number in the hint ("k").
  short?: string;
  scale?: number;
  optional?: { off: number; on: number };
  // Clearing the box resets to the default instead of being an error.
  emptyResets?: boolean;
}) {
  const auto = useAutoSave({ saved: value, save: onSave });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const off = optional ? auto.value === optional.off : false;
  const shown = (off ? optional!.on : auto.value) / scale;
  const defOff = optional ? defaultValue === optional.off : false;
  const hint =
    error === null
      ? `default ${defOff ? "off" : `${defaultValue / scale}${short}`} · ${
          max === undefined
            ? `${min / scale}${short}+`
            : `${min / scale}–${max / scale}${short}`
        }`
      : undefined;

  const finish = () => {
    if (text === null) return;
    if (!text.trim() && emptyResets) {
      setText(null);
      void auto.commit(defaultValue, { undoable: true });
      return;
    }
    const parsed = parseSettingNumber(text, {
      min: min / scale,
      max: max === undefined ? undefined : max / scale,
      integer,
    });
    if ("error" in parsed) return setError(parsed.error);
    setError(null);
    setText(null);
    const next = Math.round(parsed.value * scale * 1e6) / 1e6;
    void auto.commit(next, {
      undoable:
        auto.value > 0 && Math.abs(next - auto.value) / auto.value > 0.5,
    });
  };

  return (
    <SettingRow
      id={id}
      label={label}
      help={help}
      status={auto.status}
      error={error}
      hint={hint}
      onUndo={auto.undo}
      onReset={
        auto.value !== defaultValue
          ? () => {
              setText(null);
              setError(null);
              void auto.commit(defaultValue, { undoable: true });
            }
          : undefined
      }
      control={
        <>
          <Input
            id={id}
            type="text"
            inputMode={integer ? "numeric" : "decimal"}
            value={text ?? String(shown)}
            disabled={off}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setText(null);
                setError(null);
                e.currentTarget.blur();
              }
            }}
            className={`${FIELD} w-24 text-right tabular-nums`}
          />
          {unit && (
            <span className="text-muted-foreground min-w-16 text-sm">
              {unit}
            </span>
          )}
          {optional && (
            <Switch
              aria-label={`${label} on`}
              checked={!off}
              onCheckedChange={(on) => {
                setError(null);
                setText(null);
                void auto.commit(on ? optional.on : optional.off, {
                  undoable: !on,
                });
              }}
            />
          )}
        </>
      }
    />
  );
}

/** A choice, saved at once. */
export function SelectSetting({
  id,
  label,
  help,
  value,
  options,
  onSave,
  defaultValue,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  options: { value: string; label: string }[];
  onSave: Save<string>;
  defaultValue?: string;
}) {
  const auto = useAutoSave({ saved: value, save: onSave });
  const def = options.find((o) => o.value === defaultValue);
  return (
    <SettingRow
      id={id}
      label={label}
      help={help}
      status={auto.status}
      onUndo={auto.undo}
      hint={def ? `default ${def.label}` : undefined}
      onReset={
        defaultValue !== undefined && auto.value !== defaultValue
          ? () => void auto.commit(defaultValue, { undoable: true })
          : undefined
      }
      control={
        <Select value={auto.value} onValueChange={(v) => void auto.commit(v)}>
          <SelectTrigger id={id} className={`${FIELD} w-44`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/**
 * Text, saved on blur or Enter after `validate` (sync or async) says it's
 * fine. With `secret`, nothing saves on blur: an explicit button does.
 */
export function TextSetting({
  id,
  label,
  help,
  value,
  onSave,
  validate,
  placeholder,
  secret,
  buttonLabel = "Save",
  defaultValue = "",
  maxLength,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  onSave: Save<string>;
  validate?: (text: string) => string | null | Promise<string | null>;
  placeholder?: string;
  secret?: boolean;
  buttonLabel?: string;
  defaultValue?: string;
  maxLength?: number;
}) {
  const auto = useAutoSave({ saved: value, save: onSave });
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const finish = async () => {
    if (text === null) return;
    const next = text.trim();
    if (next === auto.value) return setText(null);
    setChecking(true);
    const problem = (await validate?.(next)) ?? null;
    setChecking(false);
    if (problem) return setError(problem);
    setError(null);
    setText(null);
    await auto.commit(next, { undoable: !next });
  };
  const dirty = text !== null && text.trim() !== auto.value;

  return (
    <SettingRow
      id={id}
      label={label}
      help={help}
      status={checking ? "saving" : auto.status}
      error={error}
      onUndo={auto.undo}
      onReset={
        !secret && auto.value !== defaultValue
          ? () => {
              setText(null);
              setError(null);
              void auto.commit(defaultValue, { undoable: true });
            }
          : undefined
      }
      control={
        <>
          <Input
            id={id}
            type={secret ? "password" : "text"}
            autoComplete="off"
            maxLength={maxLength}
            value={text ?? (secret ? "" : auto.value)}
            placeholder={placeholder}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onBlur={() => {
              if (!secret) void finish();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (secret) void finish();
                else e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                setText(null);
                setError(null);
                e.currentTarget.blur();
              }
            }}
            className={`${FIELD} w-full sm:w-64`}
          />
          {secret && (
            <Button
              type="button"
              size="sm"
              className="h-11 sm:h-9"
              disabled={!dirty || checking}
              onClick={() => void finish()}
            >
              {buttonLabel}
            </Button>
          )}
        </>
      }
    />
  );
}
