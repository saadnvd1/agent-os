"use client";

import { Share2 } from "lucide-react";
import { useBookmarkChat } from "@/components/Bookmarks/context";
import { shareUiActions } from "@/stores/shareUi";

// Opens the share dialog on the part of the chat from this message to the latest.
export function ShareFromHere({
  itemId,
  className,
}: {
  itemId: string;
  className?: string;
}) {
  const chat = useBookmarkChat();
  if (!chat) return null;
  return (
    <button
      type="button"
      aria-label="Share from here"
      title="Share from here"
      onClick={(e) => {
        e.stopPropagation();
        shareUiActions.open({
          kind: "chat",
          sessionId: chat.sessionId,
          title: "",
          fromId: itemId,
        });
      }}
      className={
        className ??
        "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-11 w-11 shrink-0 items-center justify-center rounded-md opacity-40 group-hover:opacity-100 focus-visible:opacity-100 md:h-7 md:w-7 md:opacity-0"
      }
    >
      <Share2 className="h-3.5 w-3.5" />
    </button>
  );
}
