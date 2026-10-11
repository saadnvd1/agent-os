"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { MIN_QUERY } from "@/lib/chat/find";
import type { useFind } from "./useFind";

type Find = ReturnType<typeof useFind>;

const iconButton =
  "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-11 w-11 shrink-0 items-center justify-center rounded-md disabled:pointer-events-none disabled:opacity-40 md:h-7 md:w-7";

function Count({ find }: { find: Find }) {
  if (find.query.trim().length < MIN_QUERY) return null;
  if (find.status === "searching")
    return (
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Searching" />
    );
  if (find.status === "unavailable") return <span>Unavailable</span>;
  if (!find.total) return <span>No results</span>;
  return (
    <span>
      {find.position} of {find.total}
      {find.capped && "+"}
    </span>
  );
}

// Find in the conversation: a small bar over the top of the chat. Enter goes
// to the next match up the conversation, Shift+Enter back down, Esc closes.
export function FindBar({
  find,
  focusKey,
  onClose,
}: {
  find: Find;
  // Changes whenever ⌘F is pressed again: the field takes the caret back.
  focusKey: number;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);
  const none = !find.total;
  return (
    <div
      data-find-bar
      role="search"
      className="bg-background absolute top-2 right-2 left-2 z-20 flex items-center gap-1 rounded-lg border py-0.5 pr-0.5 pl-3 shadow-sm md:left-auto md:w-96"
    >
      <input
        ref={input}
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (e.shiftKey) find.previous();
            else find.next();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        // 16px on phones, so iOS doesn't zoom in on focus.
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none md:text-sm"
      />
      <span
        aria-live="polite"
        className="text-muted-foreground shrink-0 px-1 font-mono text-[11px] tabular-nums"
      >
        <Count find={find} />
      </span>
      <button
        type="button"
        onClick={find.next}
        disabled={none}
        aria-label="Next match, further up"
        title="Next (Enter)"
        className={iconButton}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={find.previous}
        disabled={none}
        aria-label="Previous match, further down"
        title="Previous (Shift+Enter)"
        className={iconButton}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close find"
        title="Close (Esc)"
        className={iconButton}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
