"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const LIST_SECTION_LIMIT = 10;

/**
 * A long list on a Settings page: a title with the count, the first
 * `limit` items, "Show all" for the rest, and an empty state. Older items
 * can go in a group of their own (`older`), collapsed until asked for.
 */
export function ListSection<T>({
  title,
  help,
  items,
  keyOf,
  render,
  empty,
  limit = LIST_SECTION_LIMIT,
  older,
  olderLabel = "Older",
  action,
  className,
}: {
  title: string;
  help?: string;
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  empty: string;
  limit?: number;
  // Items that are shown only under their own "Show <label>" toggle.
  older?: readonly T[];
  olderLabel?: string;
  action?: ReactNode;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;
  const oldCount = older?.length ?? 0;
  const count = items.length + oldCount;
  return (
    <section className={cn("mb-5", className)} data-list-section={title}>
      <div className="flex min-h-8 items-center gap-2">
        <h3 className="text-sm font-semibold">
          {title}
          <span className="text-muted-foreground ml-1.5 font-normal tabular-nums">
            {count}
          </span>
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {help && <p className="text-muted-foreground mb-2 text-xs">{help}</p>}
      {count === 0 ? (
        <p className="bg-muted/40 text-muted-foreground rounded-xl px-3 py-4 text-sm">
          {empty}
        </p>
      ) : (
        <div className="bg-muted/40 overflow-hidden rounded-xl">
          <ul className="divide-foreground/5 divide-y">
            {shown.map((item) => (
              <li key={keyOf(item)}>{render(item)}</li>
            ))}
          </ul>
          {hidden > 0 && (
            <ShowButton onClick={() => setAll(true)}>
              Show all {items.length}
            </ShowButton>
          )}
          {all && items.length > limit && (
            <ShowButton onClick={() => setAll(false)}>Show fewer</ShowButton>
          )}
          {oldCount > 0 && (
            <>
              <ShowButton onClick={() => setShowOlder((v) => !v)}>
                {showOlder
                  ? `Hide ${olderLabel}`
                  : `${olderLabel} (${oldCount})`}
              </ShowButton>
              {showOlder && (
                <ul className="divide-foreground/5 divide-y">
                  {older!.map((item) => (
                    <li key={keyOf(item)}>{render(item)}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ShowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-primary border-foreground/5 hover:bg-muted/60 min-h-11 w-full border-t px-3 text-left text-sm"
    >
      {children}
    </button>
  );
}

/** A table that scrolls sideways in its own box, not the page. */
export function ScrollTable({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("max-w-full overflow-x-auto", className)}
      data-scroll-table
    >
      {children}
    </div>
  );
}
