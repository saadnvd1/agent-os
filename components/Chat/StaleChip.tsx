"use client";

import { Minimize2 } from "lucide-react";
import type { ChatContext, ChatState } from "@/lib/chat/events";
import { staleLabel, staleness } from "@/lib/chat/stale";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

// Above the composer while the chat is stale (lib/chat/stale): its prompt
// cache has expired and its context is long, so the next message would
// re-read all of it at full price. Send compacts first unless the reader
// picks "Send as-is", for that one send only.
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
  const stale = staleness(context, { state, thresholdTokens, now });
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
          {asIs ? "Sending as-is" : "Compact first?"}
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
        {asIs ? "Compact first" : "Send as-is"}
      </button>
    </div>
  );
}
