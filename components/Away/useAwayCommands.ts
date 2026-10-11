"use client";

import { Coffee, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { PaletteCommand } from "@/lib/palette/registry";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import {
  AWAY_DURATIONS,
  awayEnds,
  useAwayQuery,
  useSetAway,
} from "@/data/away";

// ⌘K: "Away for 4 hours", "I'm back", and the rest of the toggle's menu.
export function useAwayCommands(): void {
  const { data } = useAwayQuery();
  const setAway = useSetAway();
  const on = !!data?.away;
  const onError = (e: Error) => toast.error(e.message);
  const commands: PaletteCommand[] = [
    ...(on
      ? [
          {
            id: "away.off",
            title: "I'm back (turn Away off)",
            group: "Away",
            keywords: ["away", "back", "return"],
            icon: Undo2,
            run: () => setAway.mutate(false, { onError }),
          },
        ]
      : []),
    ...AWAY_DURATIONS.map((d) => ({
      id: `away.${d.id}`,
      title: `${on ? "Stay away" : "Away"} ${d.label.replace(/^For/, "for").replace(/^Until/, "until")}`,
      group: "Away",
      keywords: ["away", "afk", "step away", "leave"],
      icon: Coffee,
      run: () => setAway.mutate({ expiresAt: awayEnds(d.id) }, { onError }),
    })),
  ];
  usePaletteCommands("away", commands);
}
