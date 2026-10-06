"use client";

import { ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useBoardTodos,
  useLumifyHubStatus,
  useRunCard,
} from "@/data/lumifyhub";
import { useProjectsQuery } from "@/data/projects";

// Cards waiting in To Do on the linked boards, each one Run away from a task.
export function BoardTodoSection() {
  const { data: status } = useLumifyHubStatus();
  const { data: projects = [] } = useProjectsQuery();
  const enabled = !!status?.connected && projects.some((p) => p.lh_board_id);
  const { data: boards = [], isPending, error } = useBoardTodos(enabled);
  const run = useRunCard();
  if (!enabled) return null;
  const withCards = boards.filter((b) => b.cards.length > 0);
  const running = run.isPending ? run.variables?.cardId : null;

  return (
    <div className="space-y-2">
      <p className="label-mono text-muted-foreground pt-2">From the board</p>
      {isPending && (
        <div className="bg-muted/40 h-12 animate-pulse rounded-xl" />
      )}
      {error && <p className="text-destructive text-xs">{error.message}</p>}
      {!isPending && !error && withCards.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Nothing waiting in To Do.
        </p>
      )}
      {withCards.flatMap((board) =>
        board.cards.map((card) => (
          <div
            key={card.id}
            className="bg-foreground/[0.03] flex items-center gap-3 rounded-xl px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{card.title}</p>
              <p className="text-muted-foreground truncate font-mono text-[11px]">
                {board.projectName}
                {card.ticket ? ` · ${card.ticket}` : ""}
              </p>
            </div>
            {card.url && (
              <Button
                size="icon"
                variant="ghost"
                className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
                asChild
              >
                <a
                  href={card.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open card"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            <Button
              size="sm"
              className="h-11 shrink-0 sm:h-8"
              disabled={run.isPending}
              onClick={() =>
                run.mutate({ projectId: board.projectId, cardId: card.id })
              }
            >
              <Play className="h-3.5 w-3.5" />
              {running === card.id ? "Starting..." : "Run"}
            </Button>
          </div>
        ))
      )}
      {run.error && (
        <p className="text-destructive text-xs">{run.error.message}</p>
      )}
    </div>
  );
}
