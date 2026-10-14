"use client";

import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookmarkScope } from "@/lib/bookmarks/types";
import { useBookmarkChat, useTurnStart } from "./context";
import { useBookmarkToggle } from "./useBookmarkToggle";
import { useLongPress } from "@/components/Chat/useLongPress";

// Holding a message on a phone stars it. Outside a chat panel (a share, a
// test) it's just its children.
export function BookmarkPress({
  itemId,
  children,
}: {
  itemId: string;
  children: ReactNode;
}) {
  const chat = useBookmarkChat();
  if (!chat) return children;
  return (
    <Press sessionId={chat.sessionId} itemId={itemId}>
      {children}
    </Press>
  );
}

function Press({
  sessionId,
  itemId,
  children,
}: {
  sessionId: string;
  itemId: string;
  children: ReactNode;
}) {
  const { toggle } = useBookmarkToggle(sessionId, itemId, "item");
  const press = useLongPress(toggle);
  return (
    <div className="contents" {...press}>
      {children}
    </div>
  );
}

export const STAR_ON = "fill-bookmark text-bookmark";

// The star in a message's action row. Unset, it shows as its row does (on
// hover on a desktop, dimmed on a phone); set, it always shows, so a
// bookmarked message is seen while scrolling.
export function BookmarkButton({
  itemId,
  scope = "item",
  className,
}: {
  itemId: string;
  scope?: BookmarkScope;
  className?: string;
}) {
  const chat = useBookmarkChat();
  if (!chat) return null;
  return (
    <StarToggle
      sessionId={chat.sessionId}
      itemId={itemId}
      scope={scope}
      className={className}
    />
  );
}

function StarToggle({
  sessionId,
  itemId,
  scope,
  className,
}: {
  sessionId: string;
  itemId: string;
  scope: BookmarkScope;
  className?: string;
}) {
  const { on, toggle } = useBookmarkToggle(sessionId, itemId, scope);
  return (
    <button
      type="button"
      aria-label={on ? "Remove bookmark" : "Bookmark"}
      aria-pressed={on}
      title={on ? "Remove bookmark" : "Bookmark"}
      data-bookmarked={on || undefined}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-11 w-11 shrink-0 items-center justify-center rounded-md md:h-7 md:w-7",
        on
          ? "opacity-100"
          : "opacity-40 group-hover:opacity-100 focus-visible:opacity-100 md:opacity-0",
        className
      )}
    >
      <Star className={cn("h-3.5 w-3.5", on && STAR_ON)} />
    </button>
  );
}

// "Bookmark turn" on a turn's end line: marks the turn by its first message.
export function TurnBookmark({ turnEndId }: { turnEndId: string }) {
  const chat = useBookmarkChat();
  const start = useTurnStart(turnEndId);
  if (!chat || !start) return null;
  return <TurnStar sessionId={chat.sessionId} itemId={start} />;
}

function TurnStar({
  sessionId,
  itemId,
}: {
  sessionId: string;
  itemId: string;
}) {
  const { on, toggle } = useBookmarkToggle(sessionId, itemId, "turn");
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      className={cn(
        "hover:text-foreground hover:bg-foreground/[0.06] -my-2 flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 md:-my-1 md:min-h-7",
        on
          ? "text-bookmark"
          : "opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
      )}
      aria-label={on ? "Turn bookmarked" : "Bookmark turn"}
    >
      <Star className={cn("h-3 w-3", on && STAR_ON)} />
      {/* On desktop an unstarred turn shows only its star until hovered. */}
      <span
        className={cn(
          !on && "md:hidden md:group-focus-within:inline md:group-hover:inline"
        )}
      >
        {on ? "Turn bookmarked" : "Bookmark turn"}
      </span>
    </button>
  );
}
