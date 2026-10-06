"use client";

import { useRef } from "react";
import { ChevronRight } from "lucide-react";
import type { Session } from "@/lib/db";

interface NeedsYouPillProps {
  sessions: Session[];
  sessionStatuses?: Record<string, { status: string }>;
  activeSessionId?: string | null;
  onSelect: (sessionId: string) => void;
}

// One line, only when something is waiting on you: tap it to go to the next
// one, and again for the one after. The rows themselves stay in their
// projects (with the amber dot, sorted to the top).
export function NeedsYouPill({
  sessions,
  sessionStatuses,
  activeSessionId,
  onSelect,
}: NeedsYouPillProps) {
  const lastPicked = useRef<string | null>(null);
  const waiting = sessions.filter(
    (s) => sessionStatuses?.[s.id]?.status === "waiting"
  );
  if (waiting.length === 0) return null;

  const next = () => {
    const from = waiting.findIndex(
      (s) => s.id === (activeSessionId ?? lastPicked.current)
    );
    const target = waiting[(from + 1) % waiting.length];
    lastPicked.current = target.id;
    onSelect(target.id);
  };

  return (
    <button
      type="button"
      onClick={next}
      className="hover:bg-foreground/[0.04] mb-1 flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-amber-600 md:min-h-8 dark:text-amber-400"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="label-mono flex-1">
        {waiting.length} need{waiting.length === 1 ? "s" : ""} you
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
