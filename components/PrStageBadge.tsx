"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { statusKeys } from "@/data/sessions/keys";
import {
  PR_STAGE_BUSY,
  prStageText,
  PR_STAGE_SHORT,
  type PrStage,
  type PrStageName,
} from "@/lib/tasks/pr-stage";
import { cn } from "@/lib/utils";

const TONE: Record<PrStageName, string> = {
  merged: "bg-green-500/15 text-green-700 dark:text-green-400",
  conflicts: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "ci-failed": "bg-red-500/15 text-red-700 dark:text-red-400",
  "ci-running": "bg-foreground/[0.06] text-muted-foreground",
  "ci-settling": "bg-foreground/[0.06] text-muted-foreground",
  "review-running": "bg-foreground/[0.06] text-muted-foreground",
  "review-blocked": "bg-red-500/15 text-red-700 dark:text-red-400",
  waiting: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  armed: "bg-green-500/15 text-green-700 dark:text-green-400",
  open: "bg-muted text-muted-foreground",
};

// Where a task's PR is in the gates, linking to the PR. The short stage word
// is all the text; the PR number, full wording and sha live in the tooltip
// and label. `showNumber` (the session header) prefixes "PR #n".
export function PrStageBadge({
  stage,
  showNumber = false,
}: {
  stage?: PrStage;
  showNumber?: boolean;
}) {
  if (!stage) return null;
  const text = prStageText(stage);
  const short = PR_STAGE_SHORT[stage.stage];
  const visible = !showNumber
    ? short
    : stage.stage === "open"
      ? `PR #${stage.number}`
      : `PR #${stage.number} · ${short}`;
  return (
    <a
      href={stage.url}
      target="_blank"
      rel="noreferrer"
      title={`${text}${stage.sha ? ` · ${stage.sha}` : ""}`}
      aria-label={`${text}${stage.sha ? ` · ${stage.sha}` : ""}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap hover:underline",
        TONE[stage.stage]
      )}
    >
      {PR_STAGE_BUSY.has(stage.stage) && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      )}
      {visible}
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
      showNumber
    />
  );
}
