"use client";

import { Segmented } from "@/components/ui/segmented";
import {
  MODE_COPY,
  OPERATING_MODES,
  type OperatingMode,
} from "@/lib/reports/types";

const OPTIONS = OPERATING_MODES.map((m) => ({
  value: m,
  label: MODE_COPY[m].label,
  hint: MODE_COPY[m].blurb,
}));

// Manual / Assisted / Autonomous, with what the chosen one does underneath.
export function ModeChooser({
  mode,
  onChange,
  disabled,
  note,
}: {
  mode: OperatingMode;
  onChange: (m: OperatingMode) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Segmented
        label="Operating mode"
        value={mode}
        options={OPTIONS}
        onChange={onChange}
        disabled={disabled}
      />
      <p className="text-muted-foreground text-xs">
        {MODE_COPY[mode].blurb}
        {note ? ` ${note}` : ""}
      </p>
    </div>
  );
}
