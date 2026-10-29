"use client";

import { Button } from "@/components/ui/button";
import {
  PRESETS,
  presetRange,
  type RangePreset,
  type RangeRow,
} from "@/lib/share/range";

// The part of the chat to share: a preset, with what it comes to underneath.
export function RangePicker({
  rows,
  active,
  summary,
  onPick,
}: {
  rows: RangeRow[];
  active: RangePreset | null;
  summary: string;
  onPick: (preset: RangePreset) => void;
}) {
  const now = new Date();
  return (
    <div className="space-y-1.5">
      <div
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
        role="group"
        aria-label="Part of the chat to share"
      >
        {PRESETS.map((p) => {
          const empty = !presetRange(rows, p.id, now);
          return (
            <Button
              key={p.id}
              size="sm"
              variant={active === p.id ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={active === p.id}
              disabled={empty}
              title={empty ? "No messages today" : undefined}
              onClick={() => onPick(p.id)}
            >
              {p.label}
            </Button>
          );
        })}
      </div>
      <p
        className="text-muted-foreground text-xs"
        aria-live="polite"
        data-testid="share-range-summary"
      >
        {summary}
        {!active && " · Custom range"}
      </p>
    </div>
  );
}
