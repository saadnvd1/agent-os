"use client";

import { ShieldOff } from "lucide-react";
import { useApprovalsModeQuery } from "@/data/approvals";
import { settingsUiActions } from "@/stores/settingsUi";

// On screen for as long as No approvals mode is on; opens its Settings.
export function NoApprovalsBadge() {
  const { data } = useApprovalsModeQuery();
  if (!data?.on) return null;
  return (
    <button
      type="button"
      onClick={() => settingsUiActions.open("approvals")}
      title="No approvals mode is on: nothing waits for a person. Open settings."
      className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-amber-500/20 px-2 text-xs font-medium text-amber-500 ring-1 ring-amber-500/50"
    >
      <ShieldOff className="h-3.5 w-3.5" />
      No approvals
    </button>
  );
}
