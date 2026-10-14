"use client";

import { useRef, useState } from "react";
import {
  AlignLeft,
  MessageSquare,
  Pencil,
  Star,
  Terminal,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Bookmark } from "@/lib/bookmarks/types";
import { useRemoveBookmark, useSetBookmarkNote } from "@/data/bookmarks";
import { bookmarksUiActions } from "@/stores/bookmarksUi";
import { STAR_ON } from "./BookmarkButton";
import { KIND_LABEL, STATE_BADGE, canOpen, excerpt, timeOf } from "./helpers";

const KIND_ICON = {
  user: User,
  assistant: MessageSquare,
  tool: Terminal,
  turn: AlignLeft,
} as const;

// One bookmark in a list: tap to open it, edit its note, or unstar it.
export function BookmarkRow({
  bookmark: b,
  editing,
  showSession,
  onOpen,
}: {
  bookmark: Bookmark;
  editing: boolean;
  showSession?: boolean;
  onOpen: (b: Bookmark) => void;
}) {
  const Icon = KIND_ICON[b.kind];
  const badge = STATE_BADGE[b.state];
  const remove = useRemoveBookmark();
  const openable = canOpen(b);
  return (
    <div className="hover:bg-accent/60 flex flex-wrap items-start gap-2 rounded-lg px-2 py-1.5">
      <button
        type="button"
        disabled={!openable}
        onClick={() => onOpen(b)}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 py-1 text-left disabled:cursor-default"
      >
        <span className="bg-muted text-muted-foreground mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            {showSession && (
              <span className="text-foreground truncate font-medium">
                {b.sessionName}
              </span>
            )}
            <span>{KIND_LABEL[b.kind]}</span>
            <span aria-hidden>·</span>
            <span>{timeOf(b)}</span>
            {badge && (
              <span className="rounded border px-1.5 text-[10.5px] leading-4">
                {badge}
              </span>
            )}
          </span>
          <span
            className={cn(
              "line-clamp-2 text-sm break-words",
              b.kind === "tool" && "font-mono text-xs"
            )}
          >
            {excerpt(b.text) || "(empty)"}
          </span>
          {b.note && !editing && (
            <span className="text-muted-foreground block truncate text-xs">
              “{b.note}”
            </span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          aria-label={b.note ? "Edit note" : "Add note"}
          title={b.note ? "Edit note" : "Add note"}
          onClick={() => bookmarksUiActions.edit(editing ? null : b.id)}
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-11 w-11 items-center justify-center rounded-md md:h-8 md:w-8"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Remove bookmark"
          title="Remove bookmark"
          onClick={() =>
            remove.mutate(b.id, {
              onError: (err) => toast.error(err.message),
            })
          }
          className="hover:bg-foreground/[0.06] flex h-11 w-11 items-center justify-center rounded-md md:h-8 md:w-8"
        >
          <Star className={cn("h-3.5 w-3.5", STAR_ON)} />
        </button>
      </div>
      {editing && <NoteEditor bookmark={b} />}
    </div>
  );
}

function NoteEditor({ bookmark: b }: { bookmark: Bookmark }) {
  const [note, setNote] = useState(b.note ?? "");
  const save = useSetBookmarkNote();
  // Escape, or a save already sent: the blur that follows does nothing.
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    if ((b.note ?? "") === note.trim()) return bookmarksUiActions.edit(null);
    save.mutate(
      { id: b.id, note: note.trim() || null },
      {
        onSuccess: () => bookmarksUiActions.edit(null),
        onError: (err) => {
          done.current = false;
          toast.error(err.message);
        },
      }
    );
  };
  return (
    <form
      className="basis-full pb-1 pl-9"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        autoFocus
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            done.current = true;
            bookmarksUiActions.edit(null);
          }
        }}
        onBlur={commit}
        placeholder="A note to find it by"
        aria-label="Bookmark note"
        className="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-1 md:h-8 md:text-sm"
      />
    </form>
  );
}
