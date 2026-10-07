"use client";

import { useEffect, useRef, useState } from "react";
import { NEED_LABEL, type SidebarRow } from "@/lib/sidebar/shelves";
import { cn } from "@/lib/utils";

// Amber when it needs you, red when it failed, green while it works.
export function RowDot({ row }: { row: SidebarRow }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        row.need === "failed"
          ? "bg-red-500"
          : row.need
            ? "bg-amber-500"
            : row.working
              ? "bg-green-500 ring-[3px] ring-green-500/25"
              : "bg-muted-foreground/35"
      )}
    />
  );
}

// What it needs from you, or a purple dot when it changed since you looked.
export function RowBadge({ row }: { row: SidebarRow }) {
  if (row.need) {
    const asks = row.status?.asks ?? 0;
    return (
      <span
        className={cn(
          "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
          row.need === "failed"
            ? "text-red-600 dark:text-red-400"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        )}
      >
        {NEED_LABEL[row.need]}
        {asks > 1 && ` ${asks}`}
      </span>
    );
  }
  if (row.unread)
    return (
      <span
        aria-label="Unread"
        className="bg-primary h-[7px] w-[7px] shrink-0 rounded-full"
      />
    );
  return null;
}

export function RowRename({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // The menu closing hands focus back to its trigger; take it after that.
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Session name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      onClick={(e) => e.stopPropagation()}
      className="border-primary min-w-0 border-b bg-transparent text-base outline-none md:text-sm"
    />
  );
}
