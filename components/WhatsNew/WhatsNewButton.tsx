"use client";

import { Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { useWhatsNewHead } from "@/data/whats-new";
import { useWhatsNewSeen } from "@/hooks/useWhatsNewSeen";
import { unreadLabel } from "@/lib/whats-new/unread";
import { whatsNewActions } from "@/stores/whatsNew";

/** The sidebar footer row; it opens the one dialog (WhatsNewHost). */
export function WhatsNewButton() {
  const { data: head } = useWhatsNewHead();
  const { unread } = useWhatsNewSeen(head);
  return (
    <button
      type="button"
      onClick={() => whatsNewActions.open()}
      className="text-foreground hover:bg-accent/60 flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors md:min-h-9"
    >
      <Sparkles className="text-muted-foreground size-4 shrink-0" />
      <span className="flex-1 text-left">What&apos;s New</span>
      {unread > 0 && (
        <>
          <StatusPill tone="primary" className="rounded-full px-2">
            {unreadLabel(unread)} new
          </StatusPill>
          <span
            role="img"
            aria-label="Unread changes"
            className="bg-primary size-2 shrink-0 rounded-full"
          />
        </>
      )}
    </button>
  );
}
