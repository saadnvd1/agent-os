"use client";

import { useRef, useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSchedulesQuery } from "@/data/schedules";
import { schedulesBadge } from "@/lib/schedules/badge";
import { formatRunTime } from "@/lib/schedules/cron";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 450;

// Schedules at a glance: opens them, says when the next one runs (hover, or
// a long press on a phone), and turns red when a last run failed.
export function SchedulesButton({
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  const { data: schedules = [] } = useSchedulesQuery(workspaceId);
  const { next, failed } = schedulesBadge(schedules);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);

  const summary = [
    failed
      ? `${failed} schedule${failed === 1 ? "" : "s"} failed last run`
      : null,
    next
      ? `Next: ${next.name}, ${formatRunTime(next.at, next.timezone)}`
      : schedules.length
        ? "Nothing scheduled to run"
        : "No schedules yet",
  ].filter(Boolean);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Schedules. ${summary.join(". ")}`}
          className={cn(
            "relative h-11 w-11 md:h-8 md:w-8",
            failed > 0 && "text-destructive hover:text-destructive"
          )}
          onPointerDown={(e) => {
            if (e.pointerType !== "touch") return;
            pressed.current = false;
            timer.current = setTimeout(() => {
              pressed.current = true;
              setOpen(true);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={() => clearTimeout(timer.current)}
          onPointerLeave={() => clearTimeout(timer.current)}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            // A long press shows the summary; it doesn't also open.
            if (pressed.current) {
              pressed.current = false;
              return;
            }
            schedulesUiActions.open(workspaceId);
          }}
        >
          <Clock className="h-4 w-4" />
          {failed > 0 && (
            <span
              aria-hidden
              className="bg-destructive ring-background absolute top-2 right-2 h-2 w-2 rounded-full ring-2 md:top-1 md:right-1"
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {summary.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
