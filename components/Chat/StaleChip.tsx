"use client";

import { Minimize2 } from "lucide-react";
import type { ChatContext, ChatState } from "@/lib/chat/events";
import { compactionDue, staleLabel } from "@/lib/chat/stale";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

// Above the composer while the chat is due a compaction (lib/chat/stale):
// its context is past the compact threshold, and maybe its prompt cache has
// expired too, so the next message would re-read all of it at full price.
// Send compacts first unless the reader picks "Skip once", for that one
// send only.
export function StaleChip({
  context,
  state,
  thresholdTokens,
  asIs,
  onAsIs,
}: {
  context: ChatContext | null;
  state: ChatState;
  thresholdTokens: number;
  asIs: boolean;
  onAsIs: (asIs: boolean) => void;
}) {
  const watching = !!context?.cacheTtlMs && thresholdTokens > 0;
  const now = useNow(watching);
  const stale = compactionDue(context, { state, thresholdTokens, now });
  if (!stale) return null;
  return (
    <div
      role="status"
      className="bg-card popover-surface mb-2 flex items-center gap-2 rounded-2xl py-1 pr-1 pl-3 text-xs"
    >
      <Minimize2 className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {staleLabel(stale)} ·{" "}
        <span className="text-foreground">
          {asIs ? "Next send skips compacting" : "Compacts when you send"}
        </span>
      </span>
      <button
        type="button"
        aria-pressed={asIs}
        onClick={() => onAsIs(!asIs)}
        className={cn(
          "hover:bg-foreground/[0.06] min-h-11 shrink-0 rounded-xl px-3 font-medium md:min-h-8",
          asIs && "text-primary"
        )}
      >
        {asIs ? "Undo" : "Skip once"}
      </button>
    </div>
  );
}
