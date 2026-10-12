"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { statusKeys } from "@/data/sessions/keys";
import {
  PR_STAGE_BUSY,
  prStageText,
  type PrStage,
  type PrStageName,
} from "@/lib/tasks/pr-stage";
import { cn } from "@/lib/utils";

const TONE: Record<PrStageName, string> = {
  merged: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  conflicts: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "ci-failed": "bg-red-500/15 text-red-700 dark:text-red-400",
  "ci-running": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "ci-settling": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "review-running": "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "review-blocked": "bg-red-500/15 text-red-700 dark:text-red-400",
  waiting: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  armed: "bg-green-500/15 text-green-700 dark:text-green-400",
  open: "bg-muted text-muted-foreground",
};

// Where a task's PR is in the gates, linking to the PR. `compact` drops the
// "PR #n" for the sidebar row's tight space (the number stays in the title).
export function PrStageBadge({
  stage,
  compact = false,
}: {
  stage?: PrStage;
  compact?: boolean;
}) {
  if (!stage) return null;
  const text = prStageText(stage);
  return (
    <a
      href={stage.url}
      target="_blank"
      rel="noreferrer"
      title={`${text}${stage.sha ? ` · ${stage.sha}` : ""}`}
      aria-label={text}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap hover:underline",
        TONE[stage.stage]
      )}
    >
      {PR_STAGE_BUSY.has(stage.stage) && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      )}
      {compact ? text.replace("PR ", "") : text}
    </a>
  );
}

// The badge for one session, read from the status the sidebar already holds.
export function SessionPrStage({ sessionId }: { sessionId?: string | null }) {
  const { data } = useQuery<{
    statuses: Record<string, { prStage?: PrStage }>;
  }>({ queryKey: statusKeys.all, enabled: false });
  return (
    <PrStageBadge
      stage={sessionId ? data?.statuses[sessionId]?.prStage : undefined}
    />
  );
}
