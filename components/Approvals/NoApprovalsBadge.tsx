"use client";

import { ShieldOff } from "lucide-react";
import { useApprovalsModeQuery } from "@/data/approvals";
import { settingsUiActions } from "@/stores/settingsUi";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// On screen for as long as No approvals mode is on; opens its Settings.
// Shrinks to the icon when the sidebar header is narrow.
export function NoApprovalsBadge() {
  const { data } = useApprovalsModeQuery();
  if (!data?.on) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => settingsUiActions.open("approvals")}
          aria-label="No approvals mode is on. Open settings."
          className="flex h-11 w-11 shrink-0 items-center justify-center gap-1 rounded-md bg-amber-500/20 text-xs font-medium text-amber-500 ring-1 ring-amber-500/50 md:h-8 md:w-8 @[22rem]:w-auto @[22rem]:px-2 [@media(hover:none)]:md:h-11"
        >
          <ShieldOff className="h-3.5 w-3.5" />
          <span className="hidden @[22rem]:inline">No approvals</span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        No approvals mode is on: nothing waits for a person. Open settings.
      </TooltipContent>
    </Tooltip>
  );
}
