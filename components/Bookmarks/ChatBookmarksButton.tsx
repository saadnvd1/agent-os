"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionBookmarks } from "@/data/bookmarks";
import { bookmarksUiActions } from "@/stores/bookmarksUi";

// The star in a chat's header: how many it has, and its list.
export function ChatBookmarksButton({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const { data = [] } = useSessionBookmarks(sessionId);
  return (
    <button
      type="button"
      aria-label={`Bookmarks in this chat${data.length ? ` (${data.length})` : ""}`}
      title="Bookmarks in this chat"
      onClick={(e) => {
        e.stopPropagation();
        bookmarksUiActions.openChat(sessionId);
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-accent flex shrink-0 items-center justify-center gap-1 rounded-md",
        data.length > 0 && "px-1.5",
        className
      )}
    >
      <Star className="h-3.5 w-3.5" />
      {data.length > 0 && (
        <span className="text-xs tabular-nums">{data.length}</span>
      )}
    </button>
  );
}
