"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { bookmarkKey, type BookmarkScope } from "@/lib/bookmarks/types";
import { useSessionBookmarks, useToggleBookmark } from "@/data/bookmarks";
import { bookmarksUiActions } from "@/stores/bookmarksUi";

// Whether an item is starred in its chat, and a toggle that says what it did
// with a way back.
export function useBookmarkToggle(
  sessionId: string,
  itemId: string | null,
  scope: BookmarkScope
) {
  const { data } = useSessionBookmarks(sessionId);
  const existing = useMemo(
    () =>
      (itemId &&
        data?.find(
          (b) => bookmarkKey(b.itemId, b.scope) === bookmarkKey(itemId, scope)
        )) ||
      null,
    [data, itemId, scope]
  );
  const toggle = useToggleBookmark(sessionId);
  const run = useCallback(() => {
    if (!itemId) return;
    toggle.mutate(
      { itemId, scope, existing },
      {
        onSuccess: (made) => {
          if (!made) return toast("Bookmark removed");
          toast("Bookmarked", {
            action: {
              label: "Undo",
              onClick: () => toggle.mutate({ itemId, scope, existing: made }),
            },
            cancel: {
              label: "Add note",
              onClick: () => bookmarksUiActions.openChat(sessionId, made.id),
            },
            classNames: { cancelButton: "!bg-muted !text-foreground" },
          });
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }, [toggle, itemId, scope, existing, sessionId]);
  return { on: !!existing, toggle: run };
}
