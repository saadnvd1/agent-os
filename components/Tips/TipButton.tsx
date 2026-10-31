"use client";

import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTips } from "@/data/tips";
import { cn } from "@/lib/utils";
import { tipsActions } from "@/stores/tips";

/** A small footer icon that opens the tip dialog; a dot marks today's unread tip. */
export function TipButton() {
  const { data } = useTips();
  if (data && (data.off || !data.deck.length)) return null;
  // Holds the icon's place while the first answer loads, so What's New doesn't jump.
  const fresh = !!data && !data.quiet && data.today?.read === false;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title="Tip of the Day"
      aria-label={fresh ? "Tip of the Day (new tip)" : "Tip of the Day"}
      disabled={!data}
      onClick={() => tipsActions.open()}
      // The ::after widens the tap area to 44px on a phone without adding height.
      className={cn(
        "text-muted-foreground relative h-8 w-8 after:absolute after:-inset-1.5 after:content-[''] md:after:hidden [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11",
        !data && "invisible"
      )}
    >
      <Lightbulb className="h-4 w-4" />
      {fresh && (
        <span
          data-testid="tip-dot"
          className="bg-primary absolute top-1.5 right-1.5 size-1.5 rounded-full"
        />
      )}
    </Button>
  );
}
