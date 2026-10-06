"use client";

import type { Session } from "@/lib/db";

interface NeedsYouListProps {
  sessions: Session[];
  sessionStatuses?: Record<string, { status: string }>;
  projectNames: Record<string, string>;
  onSelect: (sessionId: string) => void;
}

// Sessions waiting on a human, pinned above everything else.
export function NeedsYouList({
  sessions,
  sessionStatuses,
  projectNames,
  onSelect,
}: NeedsYouListProps) {
  const waiting = sessions.filter(
    (s) => sessionStatuses?.[s.id]?.status === "waiting"
  );
  if (waiting.length === 0) return null;

  return (
    <div className="pb-2">
      <p className="label-mono px-2.5 pt-2 pb-1 text-amber-600 dark:text-amber-400">
        Needs you · {waiting.length}
      </p>
      {waiting.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          className="hover:bg-foreground/[0.04] flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left md:min-h-8"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
          {s.project_id && projectNames[s.project_id] && (
            <span className="text-muted-foreground/70 shrink-0 truncate text-[11px]">
              {projectNames[s.project_id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
