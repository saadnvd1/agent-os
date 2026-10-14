"use client";

import { PanelLeft, PanelLeftClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InboxButton } from "@/components/Inbox/InboxButton";
import { newDraft } from "@/stores/drafts";
import { DRAFT_KEYS } from "@/lib/drafts";

export function SidebarToggle({
  isPinned,
  togglePin,
}: {
  isPinned: boolean;
  togglePin: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={isPinned ? "Unpin sidebar" : "Pin sidebar"}
          className="h-7 w-7 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            togglePin();
          }}
        >
          {isPinned ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isPinned ? "Unpin sidebar" : "Pin sidebar"}
      </TooltipContent>
    </Tooltip>
  );
}

export function DesktopAppActions() {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <InboxButton />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            aria-label="New session"
            className="ml-1 h-7 w-7"
            onClick={() => newDraft({ kind: "current" })}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>New session</p>
          <p className="text-muted-foreground text-xs">{DRAFT_KEYS.current}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
