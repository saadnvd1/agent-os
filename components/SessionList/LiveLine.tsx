"use client";

import { Loader2 } from "lucide-react";
import { liveParts, liveText, type LiveTone } from "@/lib/sidebar/live-status";
import type { PrStage } from "@/lib/tasks/pr-stage";
import { prStageText } from "@/lib/tasks/pr-stage";
import { cn } from "@/lib/utils";

export interface LiveInput {
  compacting?: boolean;
  prStage?: PrStage;
}

const TONE: Record<LiveTone, string> = {
  blue: "text-blue-700 dark:text-blue-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-red-700 dark:text-red-400",
  green: "text-green-700 dark:text-green-400",
  purple: "text-purple-700 dark:text-purple-400",
  muted: "text-muted-foreground",
};

// The row's live status in small coloured words under the name: "Compacting
// · PR CI". The PR word links to the PR; its number, full wording and sha are
// in the tooltip. Renders nothing when there is nothing to say.
export function LiveLine({ compacting, prStage }: LiveInput) {
  const parts = liveParts({ compacting, prStage });
  if (parts.length === 0) return null;
  const pr = prStage
    ? `${prStageText(prStage)}${prStage.sha ? ` · ${prStage.sha}` : ""}`
    : "";
  return (
    <span
      aria-label={liveText(parts)}
      className="flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap"
    >
      {parts.map((p, i) => {
        const isPr = p.text.startsWith("PR");
        const body = (
          <>
            {p.busy && (
              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
            )}
            {p.text}
          </>
        );
        return (
          <span key={p.text} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground/50">·</span>}
            {isPr && prStage ? (
              <a
                href={prStage.url}
                target="_blank"
                rel="noreferrer"
                data-tip={pr}
                aria-label={pr}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "flex items-center gap-1 hover:underline",
                  TONE[p.tone]
                )}
              >
                {body}
              </a>
            ) : (
              <span className={cn("flex items-center gap-1", TONE[p.tone])}>
                {body}
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
