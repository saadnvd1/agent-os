"use client";

import { Coffee, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  ADropdownMenu,
  menuItem,
  separator,
} from "@/components/a/ADropdownMenu";
import { Button } from "@/components/ui/button";
import {
  AWAY_DURATIONS,
  awayEnds,
  useAwayQuery,
  useSetAway,
  type AwayDuration,
} from "@/data/away";
import { cn } from "@/lib/utils";
import { awayUntil } from "./time";

// The sidebar header's Away switch: off, a coffee cup that offers how
// long; on, the same cup in amber, whose menu says until when and turns
// it off.
export function AwayToggle() {
  const { data } = useAwayQuery();
  const setAway = useSetAway();
  const away = data?.away ?? null;
  const choose = (d: AwayDuration) =>
    setAway.mutate(
      { expiresAt: awayEnds(d) },
      { onError: (e) => toast.error(e.message) }
    );
  const durations = AWAY_DURATIONS.map((d) =>
    menuItem(away ? d.label.replace(/^For/, "Change to") : d.label, () =>
      choose(d.id)
    )
  );
  const until = away ? awayUntil(away.expiresAt) : "";
  return (
    <ADropdownMenu
      minWidth="220px"
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={away ? `Away ${until}` : "Away"}
          title={
            away
              ? `Away ${until}`
              : "Away: let the orchestrators follow work through"
          }
          disabled={setAway.isPending}
          className={cn(
            "relative h-11 w-11 md:h-8 md:w-8",
            away &&
              "bg-amber-500/20 text-amber-700 ring-1 ring-amber-500/50 hover:bg-amber-500/30 dark:text-amber-300"
          )}
        >
          <Coffee className="h-4 w-4" />
        </Button>
      }
      items={
        away
          ? [
              menuItem(
                "I'm back",
                () =>
                  setAway.mutate(false, {
                    onError: (e) => toast.error(e.message),
                  }),
                {
                  icon: Undo2,
                  description: `Away ${until}. Turning it off shows what happened.`,
                }
              ),
              separator(),
              ...durations,
            ]
          : [
              menuItem("Away", () => {}, {
                disabled: true,
                description:
                  "Orchestrators follow work through; asks reach your phone in batches.",
              }),
              separator(),
              ...durations,
            ]
      }
    />
  );
}
