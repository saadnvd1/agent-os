"use client";

import { Lightbulb } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { SidebarRow } from "@/lib/sidebar/shelves";
import type { MemberDot, TeamMember } from "@/lib/sidebar/orchestrator-row";
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

// Each department's own colour; the chief is round, in the app's primary.
const LEAD_COLOR: Record<string, string> = {
  chief: "bg-primary rounded-full",
  tech: "bg-slate-500",
  marketing: "bg-fuchsia-600",
  product: "bg-sky-600",
};

const MEMBER_DOT: Record<MemberDot, string> = {
  failed: "bg-red-500",
  asks: "bg-amber-500",
  working: "bg-green-500",
  replied: "bg-primary",
  idle: "bg-muted-foreground/60",
};

// A chief's or lead's letter: on its team card (md), in a team row's stack
// and on the rows it started (sm). The dot says what it's doing.
export function LeadAvatar({
  member,
  size = "sm",
  dot,
  label,
}: {
  member: Pick<TeamMember, "kind" | "letter" | "title">;
  size?: "sm" | "md";
  dot?: MemberDot;
  label?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label ?? member.title}
      className={cn(
        "relative grid shrink-0 place-items-center font-extrabold text-white",
        size === "md"
          ? "h-[26px] w-[26px] rounded-[7px] text-[11.5px]"
          : "h-[17px] w-[17px] rounded-[5px] text-[9px]",
        LEAD_COLOR[member.kind] ?? "bg-zinc-500"
      )}
    >
      {member.letter}
      {dot && (
        <span
          aria-hidden
          className={cn(
            "border-sidebar-background absolute rounded-full",
            size === "md"
              ? "-top-[3px] -right-[3px] h-2.5 w-2.5 border-2"
              : "-top-[2px] -right-[2px] h-[7px] w-[7px] border-[1.5px]",
            MEMBER_DOT[dot]
          )}
        />
      )}
    </span>
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

const RENAME_INPUT = "input[data-rename-input]";

function focusRename(el: HTMLInputElement) {
  el.focus();
  el.select();
}

// For a menu's onCloseAutoFocus: while a rename input is open it takes the
// focus the menu would hand back to its trigger. Reads the DOM, not state, so
// it can't see a render that hasn't landed yet.
export const keepRenameFocus = (e: Event) => {
  const el = document.querySelector<HTMLInputElement>(RENAME_INPUT);
  if (!el) return;
  e.preventDefault();
  focusRename(el);
};

// Props for a rename input that was opened from a menu. While the menu is
// still on screen it traps focus, so the input waits for keepRenameFocus; a
// blur before the input has held focus once is never a commit.
export function useRenameInput(onDone: () => void) {
  const hadFocus = useRef(false);
  const ref = useCallback((el: HTMLInputElement | null) => {
    hadFocus.current = false;
    if (el && !document.querySelector('[role="menu"]')) focusRename(el);
  }, []);
  return {
    ref,
    "data-rename-input": "",
    onFocus: () => {
      hadFocus.current = true;
    },
    onBlur: () => {
      if (hadFocus.current) onDone();
    },
  };
}

export function RowRename({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRenameInput(() => onDone(value.trim() || null));
  return (
    <input
      {...input}
      value={value}
      aria-label="Session name"
      onChange={(e) => setValue(e.target.value)}
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
