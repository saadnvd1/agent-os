"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWhatsNewHead } from "@/data/whats-new";
import { useWhatsNewSeen } from "@/hooks/useWhatsNewSeen";
import { whatsNewActions } from "@/stores/whatsNew";

/** A small footer icon that opens the one dialog (WhatsNewHost); a dot marks unread. */
export function WhatsNewButton() {
  const { data: head } = useWhatsNewHead();
  const { unread } = useWhatsNewSeen(head);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title="What's New"
      aria-label={unread > 0 ? "What's New (unread changes)" : "What's New"}
      onClick={() => whatsNewActions.open()}
      // The ::after widens the tap area to 44px on a phone without adding height.
      className="text-muted-foreground relative h-8 w-8 after:absolute after:-inset-1.5 after:content-[''] md:after:hidden [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11"
    >
      <Sparkles className="h-4 w-4" />
      {unread > 0 && (
        <span
          data-testid="whats-new-dot"
          className="bg-primary absolute top-1.5 right-1.5 size-1.5 rounded-full"
        />
      )}
    </Button>
  );
}
