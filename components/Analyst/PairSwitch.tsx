"use client";

import { usePanes } from "@/contexts/PaneContext";
import { useSessionAnalyst } from "@/data/analyst";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { PAIR_STATUS_LABEL, pairStatus, paneTmux } from "./pair";

// A phone shows one pane: a paired chat switches between its two sides
// here, with a dot on the analyst while a recommendation waits.
export function PairSwitch({
  session,
  paneId,
}: {
  session: Session | null | undefined;
  paneId: string;
}) {
  const { data: link } = useSessionAnalyst(
    session?.view === "chat" ? session.id : undefined
  );
  const { attachSession } = usePanes();
  if (!session || !link || link.endedAt) return null;

  const status = pairStatus(link);
  const sides = [
    { side: link.coder, label: "Coding agent", note: null },
    {
      side: link.analyst,
      label: "Analyst",
      note: PAIR_STATUS_LABEL[status],
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Paired sessions"
      className="bg-muted grid grid-cols-2 gap-1 px-2 pb-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      {sides.map(({ side, label, note }) => {
        const active = side.id === session.id;
        return (
          <button
            key={side.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() =>
              !active && attachSession(paneId, side.id, paneTmux(side))
            }
            className={cn(
              "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg text-sm",
              active
                ? "bg-background text-foreground font-medium shadow-sm"
                : "text-muted-foreground"
            )}
          >
            <span className="truncate">{label}</span>
            {note && status === "recommendation" && !active && (
              <span
                aria-label="Recommendation waiting"
                className="bg-primary h-2 w-2 shrink-0 rounded-full"
              />
            )}
            {note && (
              <span className="text-muted-foreground shrink-0 text-xs font-normal">
                {note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
