"use client";

import { useEffect, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useDraftCriteria, useStartLoop } from "@/data/loops";
import { DEFAULT_LIMITS, LIMIT_BOUNDS, type Limits } from "@/lib/loops/types";

const FIELDS: {
  key: "maxCycles" | "maxCostUsd" | "maxMinutes";
  label: string;
  unit: string;
}[] = [
  { key: "maxCycles", label: "Cycles", unit: "" },
  { key: "maxCostUsd", label: "Cost cap", unit: "$" },
  { key: "maxMinutes", label: "Time", unit: "min" },
];

const input =
  "bg-foreground/[0.05] focus-visible:ring-primary/40 min-h-11 w-full rounded-lg px-3 text-sm outline-none focus-visible:ring-[3px] md:min-h-9";

export function LoopSetup({
  taskId,
  onStarted,
}: {
  taskId: string;
  onStarted: () => void;
}) {
  const draft = useDraftCriteria(taskId);
  const start = useStartLoop(taskId);
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [limits, setLimits] = useState<
    Pick<Limits, "maxCycles" | "maxCostUsd" | "maxMinutes">
  >({
    maxCycles: DEFAULT_LIMITS.maxCycles,
    maxCostUsd: DEFAULT_LIMITS.maxCostUsd,
    maxMinutes: DEFAULT_LIMITS.maxMinutes,
  });

  useEffect(() => {
    draft.mutate(undefined, {
      onSuccess: (found) =>
        found.length && setCriteria(found.map((c) => c.text)),
    });
    // Once, when the setup opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filled = criteria.map((c) => c.trim()).filter(Boolean);
  const set = (i: number, text: string) =>
    setCriteria((all) => all.map((c, j) => (j === i ? text : c)));
  const error =
    start.error?.message ??
    (draft.isError ? "Couldn't draft the checklist" : null);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        After each turn the analyst reads the real diff and test output, marks
        this checklist with evidence, and sends the coding agent its next
        instruction. It never merges or publishes.
      </p>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Acceptance criteria</h3>
          {draft.isPending && (
            <span className="text-muted-foreground text-xs">Drafting…</span>
          )}
        </div>
        {criteria.map((text, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => set(i, e.target.value)}
              placeholder="Something the analyst can check"
              aria-label={`Criterion ${i + 1}`}
              className={input}
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-11 md:size-9"
              aria-label="Remove criterion"
              onClick={() =>
                setCriteria((all) =>
                  all.length > 1 ? all.filter((_, j) => j !== i) : [""]
                )
              }
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-11 md:h-8"
          onClick={() => setCriteria((all) => [...all, ""])}
        >
          <Plus /> Add criterion
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="space-y-1 text-xs">
            <span className="text-muted-foreground">
              {f.label}
              {f.unit && ` (${f.unit})`}
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={LIMIT_BOUNDS[f.key][0]}
              max={LIMIT_BOUNDS[f.key][1]}
              value={limits[f.key]}
              onChange={(e) =>
                setLimits((l) => ({ ...l, [f.key]: Number(e.target.value) }))
              }
              className={input}
            />
          </label>
        ))}
      </div>
      {error && <Notice tone="warning">{error}</Notice>}
      <Button
        className="h-11 w-full md:h-9"
        disabled={!filled.length || start.isPending}
        onClick={() =>
          start.mutate(
            {
              criteria: filled.map((text) => ({
                text,
                source: "user" as const,
              })),
              limits,
            },
            { onSuccess: onStarted }
          )
        }
      >
        <Sparkles /> {start.isPending ? "Starting…" : "Start loop"}
      </Button>
    </div>
  );
}
