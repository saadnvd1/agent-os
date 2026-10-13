"use client";

import type { ReactNode } from "react";
import { ChevronRight, Loader2, MessageCircleQuestion } from "lucide-react";
import type { ChatItem } from "@/lib/chat/events";
import type { EventTurn } from "@/lib/chat/turns";
import { cn } from "@/lib/utils";
import { clock, EventRow, ICON } from "./EventRow";
import { useRowState } from "./rowState";

type Render = (items: ChatItem[]) => ReactNode;

// A tap that ends a text selection isn't a tap.
const tapped = () => !!window.getSelection()?.isCollapsed;

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={cn(
        "text-muted-foreground/70 h-3.5 w-3.5 shrink-0 transition-transform",
        open && "rotate-90"
      )}
      aria-hidden
    />
  );
}

function Time({ at }: { at: number }) {
  return (
    <time
      dateTime={new Date(at).toISOString()}
      className="text-muted-foreground/60 shrink-0 font-mono text-[10px]"
    >
      {clock(at)}
    </time>
  );
}

// One event and the reply to it, on a line: what it was about, how the reply
// starts, when. A tap opens the whole exchange.
export function EventTurnRow({
  turn,
  renderReplies,
}: {
  turn: EventTurn;
  renderReplies: Render;
}) {
  const [open, setOpen] = useRowState(`eventturn:${turn.id}`, false);
  const Icon = ICON[turn.origin.kind];
  const toggle = () => tapped() && setOpen(!open);
  return (
    <div data-origin={turn.origin.kind} data-event-turn={turn.id}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="text-muted-foreground hover:bg-foreground/[0.04] flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs md:min-h-9"
      >
        <Icon className="text-muted-foreground/70 h-3.5 w-3.5 shrink-0" />
        <span className="text-foreground/80 max-w-[40%] min-w-0 shrink-0 truncate font-medium">
          {turn.task}
        </span>
        {turn.hasQuestion && (
          <MessageCircleQuestion
            className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-label="Asked a question"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{turn.summary}</span>
        {turn.live && (
          <Loader2
            className="h-3 w-3 shrink-0 animate-spin"
            aria-label="Working"
          />
        )}
        <Time at={turn.at} />
        <Chevron open={open} />
      </button>
      {open && (
        <div className="border-border/60 mt-1 ml-3 flex flex-col gap-3 border-l pl-3">
          <EventRow item={turn.user} origin={turn.origin} />
          {renderReplies(turn.replies)}
        </div>
      )}
    </div>
  );
}

const span = (turns: EventTurn[]) =>
  turns.length > 1 && clock(turns[0].at) !== clock(turns.at(-1)!.at)
    ? `${clock(turns[0].at)}–${clock(turns.at(-1)!.at)}`
    : clock(turns[0].at);

// Consecutive event turns: "5 updates", opened to their rows. A single one is
// just its row. While the newest is being answered it stays in view.
export function EventGroup({
  id,
  turns,
  renderReplies,
}: {
  id: string;
  turns: EventTurn[];
  renderReplies: Render;
}) {
  const [open, setOpen] = useRowState(`events:${id}`, false);
  if (turns.length === 1)
    return <EventTurnRow turn={turns[0]} renderReplies={renderReplies} />;
  const names = [...new Set(turns.map((t) => t.task))];
  const last = turns.at(-1)!;
  return (
    <div data-event-group={id}>
      <button
        type="button"
        onClick={() => tapped() && setOpen(!open)}
        aria-expanded={open}
        className="text-muted-foreground hover:bg-foreground/[0.04] bg-foreground/[0.03] flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs md:min-h-9"
      >
        <span className="text-foreground/80 shrink-0 font-medium">
          {turns.length} updates
        </span>
        <span className="min-w-0 flex-1 truncate">
          {names.slice(0, 3).join(", ")}
          {names.length > 3 ? ` +${names.length - 3}` : ""}
        </span>
        <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px]">
          {span(turns)}
        </span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="mt-1 flex flex-col">
          {turns.map((t) => (
            <EventTurnRow key={t.id} turn={t} renderReplies={renderReplies} />
          ))}
        </div>
      ) : (
        last.live && <EventTurnRow turn={last} renderReplies={renderReplies} />
      )}
    </div>
  );
}
