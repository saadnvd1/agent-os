"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { TYPE_LABEL } from "@/lib/share/view";
import type { PreviewItem } from "@/data/shares";

// The chat's messages. The text picks the range (click for a start,
// shift-click for an end); the checkbox leaves one message out of it.
export function MessageList({
  rows,
  inside,
  dropped,
  touch,
  onPick,
  onToggle,
}: {
  rows: PreviewItem[];
  inside: Set<string>;
  dropped: string[];
  touch: boolean;
  onPick: (id: string, extend: boolean) => void;
  onToggle: (id: string) => void;
}) {
  const first = rows.find((r) => inside.has(r.id))?.id;
  const listRef = useRef<HTMLUListElement>(null);
  const firstRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (listRef.current && firstRef.current)
      listRef.current.scrollTop = firstRef.current.offsetTop;
  }, [first]);

  return (
    <div className="shrink-0">
      <div className="text-muted-foreground mb-1 text-xs font-medium">
        Messages
      </div>
      <p className="text-muted-foreground mb-1.5 text-xs">
        {touch
          ? "Tap a message to start the range, then another to end it."
          : "Click a message to start the range, shift-click to end it."}
      </p>
      <ul
        ref={listRef}
        className="relative max-h-64 divide-y overflow-y-auto rounded-lg border md:max-h-[40vh]"
      >
        {rows.map((item) => {
          const on = inside.has(item.id);
          return (
            <li
              key={item.id}
              ref={item.id === first ? firstRef : undefined}
              className={cn("flex items-center", on && "bg-primary/5")}
            >
              <label className="flex min-h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  aria-label="Include this message"
                  disabled={!on}
                  checked={on && !dropped.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                />
              </label>
              <button
                type="button"
                aria-pressed={on}
                onClick={(e) => onPick(item.id, e.shiftKey)}
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1.5 pr-3 text-left text-sm",
                  !on && "text-muted-foreground opacity-60"
                )}
              >
                <span className="text-muted-foreground w-12 shrink-0 text-xs">
                  {TYPE_LABEL[item.type] ?? item.type}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {item.excerpt || "(empty)"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
