"use client";

import { toast } from "sonner";
import type { AskView } from "@/lib/orchestrator/overview";
import { useAnswerAsk } from "@/data/orchestrators";
import { AskCard } from "./AskCard";

// The orchestrator's open asks, oldest first. `limit` keeps the sidebar
// short; the rest are a tap away in its chat.
export function AsksList({
  workspaceId,
  asks,
  limit,
  onMore,
}: {
  workspaceId: string;
  asks: AskView[];
  limit?: number;
  onMore?: () => void;
}) {
  const dense = limit !== undefined;
  const answer = useAnswerAsk(workspaceId);
  if (!asks.length) return null;
  const shown = limit ? asks.slice(0, limit) : asks;
  const more = asks.length - shown.length;

  return (
    <div className="space-y-2">
      {shown.map((ask) => (
        <AskCard
          key={ask.id}
          ask={ask}
          dense={dense}
          pending={answer.isPending && answer.variables?.askId === ask.id}
          onAnswer={(a) =>
            answer.mutate(
              { askId: ask.id, ...a },
              { onError: (e) => toast.error(e.message) }
            )
          }
        />
      ))}
      {more > 0 && onMore && (
        <button
          type="button"
          onClick={onMore}
          className="text-muted-foreground hover:text-foreground min-h-11 w-full text-left text-xs md:min-h-8"
        >
          {more} more in its chat
        </button>
      )}
    </div>
  );
}
