"use client";

import type { ToolItem } from "@/lib/chat/group";
import { toolOutcome } from "@/lib/chat/tool-outcome";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./Tools";

export const MAX_CHIPS = 24;

const WORD = {
  running: "running",
  done: "ok",
  error: "failed",
  stopped: "not run",
} as const;

// One line per collapsed group: how each step ended, so the results aren't
// lost behind the fold.
export function StepOutcomes({
  tools,
  onOpen,
}: {
  tools: ToolItem[];
  onOpen: () => void;
}) {
  const shown = tools.slice(0, MAX_CHIPS);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Show steps"
      className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1.5 text-left md:min-h-0"
    >
      {shown.map((t) => {
        const code = toolOutcome(t);
        return (
          <span
            key={t.id}
            title={`${t.title}: ${WORD[t.status]}${code ? `, ${code}` : ""}`}
            aria-label={`${t.title}: ${WORD[t.status]}${code ? `, ${code}` : ""}`}
            className="flex min-w-0 items-center gap-1"
          >
            <StatusIcon status={t.status} />
            {code && (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  t.status === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {code}
              </span>
            )}
          </span>
        );
      })}
      {tools.length > shown.length && (
        <span className="text-muted-foreground/70 font-mono text-[11px]">
          +{tools.length - shown.length} more
        </span>
      )}
    </button>
  );
}
