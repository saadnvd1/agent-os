"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { parseSettingNumber } from "@/lib/settings/parse";

// A model price in $ per million tokens, saved on blur or Enter. Blank or
// invalid stays in the box with a message and is never sent (a blank used to
// save as $0); Esc puts the saved price back.
export function PriceInput({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (price: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revert = () => {
    setText(null);
    setError(null);
  };
  return (
    <span className="flex flex-col gap-1">
      <Input
        inputMode="decimal"
        value={text ?? String(value)}
        aria-label={label}
        aria-invalid={!!error}
        className="h-11 w-20 tabular-nums md:h-8"
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={() => {
          if (text === null) return;
          const parsed = parseSettingNumber(text, { min: 0, integer: false });
          if ("error" in parsed) return setError(parsed.error);
          revert();
          if (parsed.value !== value) onSave(parsed.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            revert();
            e.currentTarget.blur();
          }
        }}
      />
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
