"use client";

import { toast } from "sonner";
import { Eye, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePanes } from "@/contexts/PaneContext";
import {
  useAskAgain,
  useEndAnalyst,
  useReviewNow,
  useSessionAnalyst,
  useSetAnalystPaused,
} from "@/data/analyst";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  PAIR_STATUS_LABEL,
  pairStatus,
  partnerOf,
  paneTmux,
  type PairStatus,
} from "./pair";

const DOT: Record<PairStatus, string> = {
  paused: "bg-muted-foreground/50",
  reviewing: "bg-primary animate-pulse",
  recommendation: "bg-primary",
  watching: "bg-green-500",
};

const fail = (e: Error) => toast.error(e.message);

// A paired chat's link to the other side, with the pairing's controls.
// Nothing for a session that isn't paired.
export function PairChip({
  session,
  paneId,
}: {
  session: Session | null | undefined;
  paneId: string;
}) {
  const { data: link } = useSessionAnalyst(
    session?.view === "chat" ? session.id : undefined
  );
  const { openBeside } = usePanes();
  const id = link?.id ?? "";
  const review = useReviewNow(id);
  const pause = useSetAnalystPaused(id);
  const end = useEndAnalyst(id);
  const again = useAskAgain(id);
  if (!session || !link || link.endedAt) return null;

  const status = pairStatus(link);
  const isCoder = link.coder.id === session.id;
  const partner = partnerOf(link, session.id);
  const latest = link.recommendations[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={PAIR_STATUS_LABEL[status]}
          aria-label={`${isCoder ? "Analyst" : "Reviewing"} ${partner.name}: ${PAIR_STATUS_LABEL[status]}`}
          className="ring-border/70 bg-muted/60 hover:bg-accent flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs ring-1 ring-inset"
        >
          <Eye className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {isCoder ? "Analyst" : "Coding agent"}
          </span>
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[status])}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <div className="text-muted-foreground text-[11px] font-normal">
            {isCoder ? "Reviewed by" : "Reviewing"} ·{" "}
            {PAIR_STATUS_LABEL[status]}
          </div>
          <div className="truncate text-sm">{partner.name}</div>
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() =>
            openBeside(paneId, {
              sessionId: partner.id,
              tmux: paneTmux(partner),
            })
          }
        >
          Open {isCoder ? "analyst" : "coding agent"} beside
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={review.isPending || !!link.pendingDigestId}
          onSelect={() => review.mutate(undefined, { onError: fail })}
        >
          {review.isPending && <Loader2 className="animate-spin" />}
          {link.pendingDigestId ? "Reviewing…" : "Review now"}
        </DropdownMenuItem>
        {latest?.state === "invalid" && (
          <DropdownMenuItem
            onSelect={() => again.mutate(latest.id, { onError: fail })}
          >
            Ask for the review again
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => pause.mutate(!link.paused, { onError: fail })}
        >
          {link.paused ? "Resume reviews" : "Pause reviews"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => end.mutate(true, { onError: fail })}
        >
          Unlink and finish the analyst
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
