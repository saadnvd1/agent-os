"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useSnapshot } from "valtio";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBookmarks, type Bookmark } from "@/data/bookmarks";
import { useWorkspacesQuery } from "@/data/workspaces";
import { useUnarchiveSession } from "@/data/done";
import { toast } from "sonner";
import { openChatAt } from "@/stores/chatJump";
import { bookmarksUi, bookmarksUiActions } from "@/stores/bookmarksUi";
import { BookmarkRow } from "./BookmarkRow";
import { EmptyBookmarks } from "./EmptyBookmarks";
import { groupByDay } from "./helpers";

// Opens the chat by its address, then takes it to the message.
function openChat(b: Bookmark) {
  bookmarksUiActions.setOpen(false);
  openChatAt(b.sessionId, b.itemId);
}

// Every bookmark: one workspace's or all of them, searched on the server.
export function BookmarksDialog() {
  const snap = useSnapshot(bookmarksUi);
  // Widened to every workspace by hand; opening it again starts narrow.
  const [all, setAll] = useState(false);
  const [openedFor, setOpenedFor] = useState(snap.open);
  if (snap.open !== openedFor) {
    setOpenedFor(snap.open);
    if (snap.open) setAll(false);
  }
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const scope = all || !snap.workspaceId ? "all" : snap.workspaceId;
  const list = useBookmarks(scope, q, snap.open);
  const bookmarks = list.data?.pages.flatMap((p) => p.bookmarks) ?? [];
  const { data: workspaces = [] } = useWorkspacesQuery();
  const unarchive = useUnarchiveSession();
  // An archived chat only opens from the sidebar, so it comes back first.
  const openBookmark = (b: Bookmark) => {
    if (b.state !== "archived") return openChat(b);
    unarchive.mutate(b.sessionId, {
      onSuccess: () => {
        toast.success(`${b.sessionName} is back`);
        openChat(b);
      },
      onError: (err) => toast.error(err.message),
    });
  };
  const where = workspaces.find((w) => w.id === snap.workspaceId)?.name;

  return (
    <Dialog open={snap.open} onOpenChange={bookmarksUiActions.setOpen}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Bookmarks</DialogTitle>
          <DialogDescription className="sr-only">
            Messages starred in any chat. Open one to go to it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <label className="border-input bg-background text-muted-foreground flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 md:h-9">
            <Search className="h-4 w-4 shrink-0" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search bookmarks"
              aria-label="Search bookmarks"
              className="text-foreground min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
            />
          </label>
          {snap.workspaceId && (
            <div className="flex shrink-0 overflow-hidden rounded-md border text-xs">
              {[
                [false, where ?? "This workspace"],
                [true, "All"],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={all === value}
                  onClick={() => setAll(value as boolean)}
                  className={cn(
                    "text-muted-foreground max-w-36 truncate px-3 py-2 md:py-1.5",
                    all === value && "bg-accent text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="-mx-2">
          {list.isPending &&
            [0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-muted/40 mx-2 mb-2 h-14 animate-pulse rounded-xl"
              />
            ))}
          {list.isError && (
            <p className="text-destructive px-2 text-sm">
              {list.error.message}
            </p>
          )}
          {!list.isPending &&
            !list.isError &&
            bookmarks.length === 0 &&
            (q ? (
              <div className="text-muted-foreground px-4 py-8 text-center text-sm">
                No bookmarks match “{q}”
                {scope === "all" ? "." : " in this workspace."}
                {scope !== "all" && (
                  <button
                    type="button"
                    onClick={() => setAll(true)}
                    className="text-primary block min-h-11 w-full"
                  >
                    Search all workspaces
                  </button>
                )}
              </div>
            ) : (
              <EmptyBookmarks
                title="No bookmarks yet"
                body={
                  scope === "all"
                    ? "Messages you star in any chat collect here."
                    : "Messages you star in any chat in this workspace collect here."
                }
              />
            ))}
          {groupByDay(bookmarks).map((g) => (
            <section key={g.day}>
              <h3 className="text-muted-foreground px-2 pt-3 pb-1 font-mono text-[11px] tracking-wide uppercase">
                {g.day}
              </h3>
              {g.bookmarks.map((b) => (
                <BookmarkRow
                  key={b.id}
                  bookmark={b}
                  showSession
                  editing={snap.editing === b.id}
                  onOpen={openBookmark}
                />
              ))}
            </section>
          ))}
          {list.hasNextPage && (
            <button
              type="button"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="text-muted-foreground hover:text-foreground flex min-h-11 w-full items-center justify-center text-sm"
            >
              {list.isFetchingNextPage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Show older"
              )}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
