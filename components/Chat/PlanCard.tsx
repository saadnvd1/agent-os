"use client";

import { Check, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatItem } from "@/lib/chat/events";
import { Markdown } from "./Markdown";

type PlanItem = Extract<ChatItem, { kind: "plan" }>;

// A plan the agent proposed from plan mode: carry it out, or keep planning.
export function PlanCard({
  item,
  onCarryOut,
  onKeepPlanning,
}: {
  item: PlanItem;
  // Absent while a turn runs.
  onCarryOut?: () => void;
  onKeepPlanning: () => void;
}) {
  return (
    <div className="bg-primary/[0.06] space-y-3 rounded-xl p-3">
      <div className="text-primary flex items-center gap-2 text-xs font-medium">
        <ListChecks className="h-4 w-4" />
        Plan
      </div>
      <Markdown text={item.plan} />
      {item.carried ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Check className="h-3.5 w-3.5" />
          Carried out
        </p>
      ) : (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            className="h-11 md:h-9"
            onClick={onKeepPlanning}
          >
            Keep planning
          </Button>
          <Button
            className="h-11 md:h-9"
            disabled={!onCarryOut}
            onClick={onCarryOut}
          >
            Carry it out
          </Button>
        </div>
      )}
    </div>
  );
}
