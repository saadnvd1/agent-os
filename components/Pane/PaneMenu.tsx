"use client";

import { toast } from "sonner";
import {
  BookOpen,
  Command,
  Copy,
  Link,
  MoreHorizontal,
  Share2,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Star,
  Unplug,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copySessionLink, writeClipboard } from "@/hooks/useCopyToClipboard";
import type { Session } from "@/lib/db";
import { shareUiActions } from "@/stores/shareUi";
import { useSessionBookmarks } from "@/data/bookmarks";
import { useDocsWorkspace } from "@/data/lumifyhub/docs";
import { bookmarksUiActions } from "@/stores/bookmarksUi";
import { docsUiActions } from "@/stores/docsUi";
import { paletteActions } from "@/stores/palette";
import { MoveMenuItems } from "@/components/Tasks/MoveMenuItems";

interface PaneMenuProps {
  session: Session | null | undefined;
  // The chat on show, for its bookmarks; null for a terminal or another view.
  bookmarksSessionId?: string | null;
  canSplit: boolean;
  canClose: boolean;
  hasAttachedTmux: boolean;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClose: () => void;
  onDetach: () => void;
}

// The pane's less-used actions; the session's ids live here rather than in
// the bar.
export function PaneMenu({
  session,
  bookmarksSessionId,
  canSplit,
  canClose,
  hasAttachedTmux,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
  onDetach,
}: PaneMenuProps) {
  const { data: bookmarks = [] } = useSessionBookmarks(bookmarksSessionId);
  const docs = useDocsWorkspace(session?.project_id);
  const copyId = async (id: string) => {
    try {
      await writeClipboard(id);
      toast.success("Session ID copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Pane actions"
          className="h-7 w-7"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {session && (
          <>
            <DropdownMenuLabel className="space-y-0.5">
              <div className="truncate text-sm">{session.name}</div>
              {session.tmux_name && (
                <div className="text-muted-foreground truncate font-mono text-[11px] font-normal">
                  {session.tmux_name}
                </div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => copySessionLink(session.id)}>
              <Link className="h-4 w-4" />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => copyId(session.id)}>
              <Copy className="h-4 w-4" />
              Copy session ID
            </DropdownMenuItem>
            {session.view === "chat" && (
              <DropdownMenuItem
                onSelect={() =>
                  shareUiActions.open({
                    kind: "chat",
                    sessionId: session.id,
                    title: session.name,
                  })
                }
              >
                <Share2 className="h-4 w-4" />
                Share…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <MoveMenuItems
              session={session}
              Item={DropdownMenuItem}
              After={DropdownMenuSeparator}
              iconClassName="h-4 w-4"
            />
          </>
        )}
        {bookmarksSessionId && (
          <DropdownMenuItem
            onSelect={() => bookmarksUiActions.openChat(bookmarksSessionId)}
          >
            <Star className="h-4 w-4" />
            Bookmarks
            {bookmarks.length > 0 && (
              <DropdownMenuShortcut>{bookmarks.length}</DropdownMenuShortcut>
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={paletteActions.open}>
          <Command className="h-4 w-4" />
          Command palette
          <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        {docs && (
          <DropdownMenuItem onSelect={() => docsUiActions.open(docs.id)}>
            <BookOpen className="h-4 w-4" />
            Docs
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {hasAttachedTmux && (
          <DropdownMenuItem onSelect={onDetach}>
            <Unplug className="h-4 w-4" />
            Detach from tmux
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!canSplit} onSelect={onSplitHorizontal}>
          <SplitSquareHorizontal className="h-4 w-4" />
          Split right
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canSplit} onSelect={onSplitVertical}>
          <SplitSquareVertical className="h-4 w-4" />
          Split down
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canClose} onSelect={onClose}>
          <X className="h-4 w-4" />
          Close pane
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
