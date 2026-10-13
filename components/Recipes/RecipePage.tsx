"use client";

import { useState } from "react";
import { Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useArchiveRecipe,
  useClearCarry,
  useRecipeQuery,
} from "@/data/recipes";
import { formatRunTime } from "@/lib/schedules/cron";
import { RunChip } from "./RunChip";
import { RunHistory, Totals } from "./RunHistory";
import { RunSheet } from "./RunSheet";

export function RecipePage({
  id,
  openRun,
  onEdit,
  onGone,
}: {
  id: string;
  openRun: boolean;
  onEdit: () => void;
  onGone: () => void;
}) {
  const { data, isPending, error } = useRecipeQuery(id);
  const archive = useArchiveRecipe();
  const clearCarry = useClearCarry();
  const [running, setRunning] = useState(openRun);
  const [confirm, setConfirm] = useState(false);
  if (isPending)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />;
  if (error || !data)
    return (
      <p className="text-destructive text-sm">
        {error?.message ?? "Not found"}
      </p>
    );
  const r = data.recipe;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold">{r.name}</h3>
          {r.liveRun && <RunChip status={r.liveRun.status} />}
        </div>
        <p className="text-muted-foreground text-sm">
          {r.kind === "task" ? "Task" : "Session"} ·{" "}
          {r.projectName ?? "project gone"}
          {r.timer ? ` · ${r.timer.description}` : " · no timer"}
        </p>
        {r.timer && (
          <p className="text-muted-foreground text-xs">
            {r.timer.enabled && r.timer.nextRunAt
              ? `Next ${formatRunTime(r.timer.nextRunAt, r.timer.timezone)}`
              : "Timer off"}{" "}
            · {r.timer.timezone}
          </p>
        )}
        <Totals totals={r.totals} />
      </div>
      <p className="bg-foreground/[0.03] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
        {r.brief}
      </p>
      {running ? (
        <RunSheet recipe={r} onClose={() => setRunning(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-11 md:h-8"
            disabled={!!r.liveRun}
            onClick={() => setRunning(true)}
          >
            <Play className="h-3.5 w-3.5" />
            {r.liveRun ? "Running" : "Run"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-11 md:h-8"
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          {confirm ? (
            <Button
              size="sm"
              variant="destructive"
              className="h-11 md:h-8"
              disabled={archive.isPending}
              onClick={() => archive.mutate(r.id, { onSuccess: onGone })}
            >
              Remove (keeps history)
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-11 md:h-8"
              onClick={() => setConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
      )}
      {r.lastRun?.summary && !r.carry_cleared_at && (
        <p className="text-muted-foreground text-xs">
          The next run is told what the last one reported.{" "}
          <button
            type="button"
            className="text-primary font-medium underline-offset-2 hover:underline"
            disabled={clearCarry.isPending}
            onClick={() => clearCarry.mutate(r.id)}
          >
            Start the next run fresh
          </button>
        </p>
      )}
      <RunHistory runs={data.runs} />
    </div>
  );
}
