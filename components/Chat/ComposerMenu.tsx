"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuOption {
  key: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  description?: string;
}

// The menu above the composer: "/" commands and skills, "@" files and
// folders, best match first.
export function ComposerMenu({
  label,
  empty,
  options,
  active,
  onPick,
  onHover,
  refresh,
}: {
  label: string;
  empty: string;
  options: MenuOption[];
  active: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  // Reloads the list (a skill added since it was read).
  refresh?: { onClick: () => void; busy: boolean };
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
      aria-label={label}
      className="popover-surface absolute right-0 bottom-full left-0 mb-2 max-h-[min(55vh,340px)] overflow-x-hidden overflow-y-auto rounded-xl p-1.5"
    >
      {refresh && (
        <div className="flex items-center justify-between pl-2.5">
          <span className="text-muted-foreground text-xs">{label}</span>
          <button
            type="button"
            aria-label="Refresh commands"
            title="Refresh commands"
            disabled={refresh.busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={refresh.onClick}
            className="text-muted-foreground hover:text-foreground flex h-11 w-11 items-center justify-center rounded-lg md:h-7 md:w-7"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refresh.busy && "animate-spin")}
            />
          </button>
        </div>
      )}
      {options.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-2 text-sm">{empty}</p>
      ) : (
        options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            role="option"
            aria-selected={i === active}
            data-index={i}
            onMouseEnter={() => onHover(i)}
            // Keep focus in the textarea so the keyboard stays up on phones.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(i)}
            className={cn(
              "flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-2.5 py-1.5 text-left md:min-h-9",
              i === active
                ? "bg-foreground/[0.07]"
                : "hover:bg-foreground/[0.04]"
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              {o.icon}
              <span className="max-w-[75%] shrink-0 truncate font-mono text-sm">
                {o.label}
              </span>
              {o.hint && (
                <span className="text-muted-foreground/70 min-w-0 truncate font-mono text-xs">
                  {o.hint}
                </span>
              )}
            </span>
            {o.description && (
              <span className="text-muted-foreground w-full truncate text-xs">
                {o.description}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
