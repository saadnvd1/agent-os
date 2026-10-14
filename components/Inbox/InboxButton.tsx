"use client";

import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useInbox } from "@/hooks/useInbox";
import { inboxUiActions } from "@/stores/inboxUi";

// One button for everything waiting on you: sessions, tasks, asks and
// questions, messages.
export function InboxButton() {
  const { counts } = useInbox();
  const label = counts.total > 0 ? `Inbox (${counts.total})` : "Inbox";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className="relative h-7 w-7"
          onClick={() => inboxUiActions.open()}
        >
          <Inbox className="h-4 w-4" />
          {counts.total > 0 && (
            <span className="bg-primary text-primary-foreground ring-background absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] leading-none font-bold tabular-nums ring-2">
              {counts.total > 99 ? "99+" : counts.total}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Inbox</TooltipContent>
    </Tooltip>
  );
}
