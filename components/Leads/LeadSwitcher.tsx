"use client";

import { memo } from "react";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { LeadAvatar } from "@/components/SessionList/RowParts";
import { openSessionById } from "@/components/Chat/session-link";
import { memberLetter } from "@/lib/leads/order";
import { shortTitle } from "@/lib/leads/short-title";
import { cn } from "@/lib/utils";

// On a phone, a team member's chat gets the rest of its team one tap away,
// under the header, instead of a trip through the sidebar drawer. Null in
// any other chat and on wider screens, where the sidebar shows the team.
export const LeadSwitcher = memo(function LeadSwitcher({
  sessionId,
}: {
  sessionId: string;
}) {
  const { data } = useOrchestratorsQuery();
  const team = data?.find((o) =>
    o.team?.some((m) => m.sessionId === sessionId)
  )?.team;
  if (!team || team.length < 2) return null;
  return (
    <nav
      aria-label="Team"
      className="flex shrink-0 [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 pt-2 md:hidden"
    >
      {team.map((m) => {
        const on = m.sessionId === sessionId;
        return (
          <button
            key={m.sessionId}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => !on && openSessionById(m.sessionId)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px]",
              on
                ? "bg-foreground/[0.08] text-foreground font-semibold"
                : "text-muted-foreground"
            )}
          >
            <LeadAvatar
              member={{
                kind: m.kind,
                letter: memberLetter(m.kind),
                title: m.title,
              }}
            />
            {shortTitle(m.title)}
          </button>
        );
      })}
    </nav>
  );
});
