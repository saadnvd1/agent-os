"use client";

import { useEffect, useRef } from "react";
import type { ChatCommand } from "@/lib/chat/events";
import { cn } from "@/lib/utils";

// The "/" menu above the composer: commands and skills, best match first.
export function CommandMenu({
  commands,
  active,
  onPick,
  onHover,
}: {
  commands: ChatCommand[];
  active: number;
  onPick: (command: ChatCommand) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Commands"
      className="popover-surface absolute right-0 bottom-full left-0 mb-2 max-h-[min(55vh,340px)] overflow-x-hidden overflow-y-auto rounded-xl p-1.5"
    >
      {commands.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm">
          No matching commands
        </p>
      ) : (
        commands.map((c, i) => (
          <button
            key={`${c.name}-${i}`}
            type="button"
            role="option"
            aria-selected={i === active}
            data-index={i}
            onMouseEnter={() => onHover(i)}
            // Keep focus in the textarea so the keyboard stays up on phones.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className={cn(
              "flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-2.5 py-1.5 text-left md:min-h-9",
              i === active
                ? "bg-foreground/[0.07]"
                : "hover:bg-foreground/[0.04]"
            )}
          >
            <span className="flex w-full min-w-0 items-baseline gap-2">
              <span className="shrink-0 font-mono text-sm">/{c.name}</span>
              {c.argumentHint && (
                <span className="text-muted-foreground/70 min-w-0 truncate font-mono text-xs">
                  {c.argumentHint}
                </span>
              )}
            </span>
            {c.description && (
              <span className="text-muted-foreground w-full truncate text-xs">
                {c.description}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
