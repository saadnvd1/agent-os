"use client";

import { useState } from "react";
import { ExternalLink, Layers, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useBoardTodos,
  useLumifyHubStatus,
  useRunCard,
} from "@/data/lumifyhub";
import { useProjectsQuery } from "@/data/projects";
import { RunStackDialog } from "@/components/Stacks";
import type { BoardCardView } from "@/lib/lumifyhub/types";

// Cards waiting in To Do on the linked boards, each one Run away from a task,
// and each board one "Run as stack" away from all of them in order.
export function BoardTodoSection() {
  const { data: status } = useLumifyHubStatus();
  const { data: projects = [] } = useProjectsQuery();
  const enabled = !!status?.connected && projects.some((p) => p.lh_board_id);
  const { data: boards = [], isPending, error } = useBoardTodos(enabled);
  const run = useRunCard();
  const [stackProject, setStackProject] = useState<string | null>(null);
  if (!enabled) return null;
  const running = run.isPending ? run.variables?.cardId : null;

  return (
    <div className="space-y-2">
      <p className="label-mono text-muted-foreground pt-2">From the board</p>
      {isPending && (
        <div className="bg-muted/40 h-12 animate-pulse rounded-xl" />
      )}
      {error && <p className="text-destructive text-xs">{error.message}</p>}
      {boards.map((board) => (
        <div key={board.projectId} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {board.projectName}
              {board.boardName ? ` · ${board.boardName}` : ""}
              {board.cards.length ? "" : " · nothing waiting in To Do"}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-11 shrink-0 sm:h-8"
              onClick={() => setStackProject(board.projectId)}
            >
              <Layers className="h-3.5 w-3.5" />
              Run as stack
            </Button>
          </div>
          {board.cards.map((card) => (
            <CardRow
              key={card.id}
              card={card}
              disabled={run.isPending}
              starting={running === card.id}
              onRun={() =>
                run.mutate({ projectId: board.projectId, cardId: card.id })
              }
            />
          ))}
        </div>
      ))}
      {run.error && (
        <p className="text-destructive text-xs">{run.error.message}</p>
      )}
      <RunStackDialog
        projectId={stackProject}
        onClose={() => setStackProject(null)}
      />
    </div>
  );
}

function CardRow(props: {
  card: BoardCardView;
  disabled: boolean;
  starting: boolean;
  onRun: () => void;
}) {
  const { card } = props;
  return (
    <div className="bg-foreground/[0.03] flex items-center gap-3 rounded-xl px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{card.title}</p>
        {card.ticket && (
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {card.ticket}
          </p>
        )}
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
        disabled={props.disabled}
        onClick={props.onRun}
      >
        <Play className="h-3.5 w-3.5" />
        {props.starting ? "Starting..." : "Run"}
      </Button>
    </div>
  );
}
