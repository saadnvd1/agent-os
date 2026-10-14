"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSessionBookmarks } from "@/data/bookmarks";
import { bookmarksUi, bookmarksUiActions } from "@/stores/bookmarksUi";
import { BookmarkRow } from "./BookmarkRow";
import { EmptyBookmarks } from "./EmptyBookmarks";

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

// One chat's bookmarks, in chat order; a tap takes the chat to the message.
export function ChatBookmarksDialog() {
  const snap = useSnapshot(bookmarksUi);
  const sessionId = snap.chatSessionId;
  const { data = [], isPending } = useSessionBookmarks(sessionId);
  return (
    <Dialog
      open={!!sessionId}
      onOpenChange={(open) => !open && bookmarksUiActions.closeChat()}
    >
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Bookmarks in this chat</DialogTitle>
          <DialogDescription className="sr-only">
            The messages starred in this chat, in the order they were said.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 space-y-0.5">
          {isPending && !!sessionId && (
            <div className="bg-muted/40 mx-2 h-14 animate-pulse rounded-xl" />
          )}
          {!isPending && data.length === 0 && (
            <EmptyBookmarks
              title="No bookmarks in this chat"
              body="Star a message, a tool call or a turn to come back to it here. On a phone you can also hold a message."
            />
          )}
          {data.map((b) => (
            <BookmarkRow
              key={b.id}
              bookmark={b}
              editing={snap.editing === b.id}
              onOpen={() => {
                bookmarksUiActions.closeChat();
                bookmarksUiActions.jump(b.sessionId, b.itemId);
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
