"use client";

import { Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDirectionChat } from "./direction-context";

// "Pin as direction" among a message's actions, in a lead chat only. The
// server copies the words, so only the owner's own messages can be pinned.
export function PinButton({ itemId }: { itemId: string }) {
  const chat = useDirectionChat();
  if (!chat || chat.view.pins.some((p) => p.chatItemId === itemId)) return null;
  return (
    <button
      type="button"
      aria-label="Pin as direction"
      title="Pin as direction"
      disabled={chat.busy}
      onClick={(e) => {
        e.stopPropagation();
        chat.pin(itemId);
      }}
      className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-11 w-11 shrink-0 items-center justify-center rounded-md opacity-40 group-hover:opacity-100 focus-visible:opacity-100 md:h-7 md:w-7 md:opacity-0"
    >
      <Pin className="h-3.5 w-3.5" />
    </button>
  );
}

// Under a message: "Pinned as direction", or the lead's suggestion to pin
// it, answered in one tap.
export function PinNote({ itemId }: { itemId: string }) {
  const chat = useDirectionChat();
  if (!chat) return null;
  const pin = chat.view.pins.find((p) => p.chatItemId === itemId);
  if (pin)
    return (
      <span
        data-copy-skip
        className="border-primary/50 text-primary rounded-md border border-dashed px-1.5 text-[11px]"
      >
        Pinned as direction · #{pin.id}
      </span>
    );
  const proposal = chat.view.proposals.find((p) => p.chatItemId === itemId);
  if (!proposal) return null;
  return (
    <div
      data-copy-skip
      className="border-primary/40 flex max-w-[85%] items-center gap-1 rounded-lg border border-dashed py-0.5 pr-0.5 pl-2.5"
    >
      <Pin className="text-primary h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 text-xs">
        The {chat.view.title} suggests pinning this
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-11 px-2.5 md:h-7"
        disabled={chat.busy}
        onClick={() => chat.answer(proposal.id, false)}
      >
        Dismiss
      </Button>
      <Button
        size="sm"
        className="h-11 px-2.5 md:h-7"
        disabled={chat.busy}
        onClick={() => chat.answer(proposal.id, true)}
      >
        Pin
      </Button>
    </div>
  );
}
