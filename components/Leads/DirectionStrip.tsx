"use client";

import { memo, useState } from "react";
import { ChevronRight, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pinDate, type DirectionChat } from "./direction-context";
import { DirectionSheet } from "./DirectionSheet";

// The row above a lead chat's messages: the owner's pinned direction (his
// own words, copied by the server), and the lead's pins waiting for his tap.
// Tapping it opens the history. Memoized: the chat under it re-renders for
// every streamed word.
export const DirectionStrip = memo(function DirectionStrip({
  chat,
  sessionId,
}: {
  chat: DirectionChat;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const { view } = chat;
  const [newest] = view.pins;
  const waiting = view.proposals.length;
  const review = waiting > 0 || view.switchPending;
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pt-3">
      <div className="border-primary/30 bg-primary/[0.04] rounded-xl border">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Direction history"
          className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left"
        >
          <Pin className="text-primary h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 text-sm leading-snug">
            <span className="text-primary font-medium">
              Your direction
              {view.pins.length > 0 && ` · ${view.pins.length} pinned`}
            </span>
            {newest ? (
              <>
                <span className="block truncate md:line-clamp-2 md:whitespace-normal">
                  &ldquo;{newest.quote}&rdquo;
                </span>
                <span className="text-muted-foreground hidden text-xs md:inline">
                  pin #{newest.id} · you, {pinDate(newest.setAt)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground block text-xs">
                None pinned yet. Pin any of your messages from its actions.
              </span>
            )}
          </span>
          <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
        </button>
        {review && (
          <div className="border-primary/20 flex items-center gap-2 border-t py-1.5 pr-1.5 pl-3">
            <p className="min-w-0 flex-1 text-xs leading-snug">
              {view.switchPending
                ? `Adopted: it keeps its old conversation until you confirm ${waiting === 1 ? "its pin" : waiting ? `its ${waiting} pins` : "the switch"}.`
                : `The ${view.title} proposes ${waiting === 1 ? "a pin" : `${waiting} pins`} from your messages.`}
            </p>
            <Button
              size="sm"
              className="h-11 md:h-8"
              onClick={() => setOpen(true)}
            >
              Review
            </Button>
          </div>
        )}
      </div>
      <DirectionSheet
        chat={chat}
        sessionId={sessionId}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
});
