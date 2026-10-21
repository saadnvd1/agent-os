"use client";

import { MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExportEstimate } from "@/data/exports";
import type { ExportRange } from "@/lib/export/view";

type Chip = "all" | "last1" | "last5" | "compaction" | "custom";

const CHIPS: { id: Chip; label: string }[] = [
  { id: "all", label: "Whole session" },
  { id: "last1", label: "Last turn" },
  { id: "last5", label: "Last 5" },
  { id: "compaction", label: "Since compaction" },
  { id: "custom", label: "Custom" },
];

const chipOf = (r: ExportRange | undefined): Chip =>
  !r
    ? "all"
    : "sinceCompaction" in r
      ? "compaction"
      : "last" in r
        ? r.last === 1
          ? "last1"
          : r.last === 5
            ? "last5"
            : "custom"
        : "custom";

const when = (at: string) => at.slice(5, 16).replace("T", " ");
const clock = (at: string) => at.slice(11, 16);

const SELECT =
  "bg-background border-input min-h-11 w-full min-w-0 rounded-md border px-2 text-sm";

export function RangePicker({
  range,
  est,
  onChange,
  onSelectInChat,
}: {
  range: ExportRange | undefined;
  est: ExportEstimate | null;
  onChange: (r: ExportRange | undefined) => void;
  onSelectInChat: () => void;
}) {
  const chip = chipOf(range);
  const turns = (est?.turns ?? []).filter((t) => t.n > 0);
  const sel = est?.selected;
  const pick = (id: Chip) => {
    if (id === "all") onChange(undefined);
    else if (id === "last1") onChange({ last: 1 });
    else if (id === "last5") onChange({ last: 5 });
    else if (id === "compaction") onChange({ sinceCompaction: true });
    else
      onChange({
        from: sel?.from ?? 1,
        to: sel?.to ?? Math.max(1, turns.length),
      });
  };
  const custom = range && "from" in range ? range : null;
  const options = turns.map((t) => (
    <option key={t.n} value={t.n}>
      {`#${t.n} · ${when(t.at)} · ${t.excerpt.slice(0, 40)}`}
    </option>
  ));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Range">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={chip === c.id}
            onClick={() => pick(c.id)}
            className={cn(
              "min-h-11 rounded-full border px-3.5 text-sm transition-colors",
              chip === c.id
                ? "border-primary bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.04]"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {custom && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <label className="text-muted-foreground space-y-1 text-xs">
            From
            <select
              className={SELECT}
              value={custom.from}
              onChange={(e) =>
                onChange({
                  from: Number(e.target.value),
                  to: Math.max(custom.to, Number(e.target.value)),
                })
              }
            >
              {options}
            </select>
          </label>
          <label className="text-muted-foreground space-y-1 text-xs">
            To
            <select
              className={SELECT}
              value={custom.to}
              onChange={(e) =>
                onChange({
                  from: Math.min(custom.from, Number(e.target.value)),
                  to: Number(e.target.value),
                })
              }
            >
              {options}
            </select>
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground min-w-0 text-xs">
          {sel && sel.startedAt && sel.endedAt
            ? `Turns ${sel.from}–${sel.to} · ${sel.turns} ${sel.turns === 1 ? "turn" : "turns"} · ${clock(sel.startedAt)}–${clock(sel.endedAt)}`
            : "Counting turns…"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 shrink-0"
          onClick={onSelectInChat}
        >
          <MousePointerClick className="h-4 w-4" />
          Select in chat
        </Button>
      </div>
    </div>
  );
}
