"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuOption {
  key: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  description?: string;
  // A section heading shown above this option when it starts a new section.
  group?: string;
  // A small label on the row (where a command comes from).
  badge?: string;
}

// The part of `text` that matches what was typed, picked out.
function Marked({ text, query }: { text: string; query?: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="text-primary bg-transparent font-semibold">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
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
  highlight,
}: {
  label: string;
  empty: string;
  options: MenuOption[];
  active: number;
  onPick: (index: number) => void;
  onHover: (index: number) => void;
  // Reloads the list (a skill added since it was read).
  refresh?: { onClick: () => void; busy: boolean };
  highlight?: string;
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
          <Fragment key={o.key}>
            {o.group && o.group !== options[i - 1]?.group && (
              <div className="text-muted-foreground px-2.5 pt-2 pb-0.5 text-[11px] tracking-wide uppercase">
                {o.group}
              </div>
            )}
            <button
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
                <span className="max-w-[65%] shrink-0 truncate font-mono text-sm">
                  {o.icon ? (
                    o.label
                  ) : (
                    <Marked text={o.label} query={highlight} />
                  )}
                </span>
                {o.hint && (
                  <span className="text-muted-foreground/70 min-w-0 truncate font-mono text-xs">
                    {o.hint}
                  </span>
                )}
                {o.badge && (
                  <span className="text-muted-foreground border-border ml-auto shrink-0 rounded-full border px-2 text-[10px]">
                    {o.badge}
                  </span>
                )}
              </span>
              {o.description && (
                <span className="text-muted-foreground line-clamp-2 w-full text-xs">
                  {o.icon ? (
                    o.description
                  ) : (
                    <Marked text={o.description} query={highlight} />
                  )}
                </span>
              )}
            </button>
          </Fragment>
        ))
      )}
    </div>
  );
}
