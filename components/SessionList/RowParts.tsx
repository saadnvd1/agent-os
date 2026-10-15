"use client";

import { Lightbulb } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import { cn } from "@/lib/utils";

// Amber when it needs you, red when it failed, green while it works, and a
// pulsing blue while it summarises its context.
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
            : row.compacting
              ? "animate-pulse bg-blue-500 ring-[3px] ring-blue-500/25"
              : row.working
                ? "bg-green-500 ring-[3px] ring-green-500/25"
                : "bg-muted-foreground/35"
      )}
    />
  );
}

// What belongs to the row above it (a conductor's workers, an
// orchestrator's quick changes), behind a thin rule.
export function NestRail({ children }: { children: ReactNode }) {
  return (
    <div className="border-foreground/10 ml-3.5 border-l pl-1.5">
      {children}
    </div>
  );
}

export function UnreadDot() {
  return (
    <span
      aria-label="Unread"
      className="bg-primary h-[7px] w-[7px] shrink-0 rounded-full"
    />
  );
}

// A learning card is waiting on this session.
export function CardBadge({ count }: { count: number }) {
  return (
    <span
      data-tip="Learning card waiting: open the session to keep or drop it"
      className="shrink-0"
    >
      <Lightbulb
        aria-label={count > 1 ? `${count} learning cards` : "Learning card"}
        className="h-3 w-3 text-amber-600 dark:text-amber-400"
      />
    </span>
  );
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
