"use client";

import { Loader2, MessageCircleQuestion, Square } from "lucide-react";
import type { ChatItem, ChatState } from "@/lib/chat/events";
import { formatElapsed } from "@/lib/chat/elapsed";
import { useNow } from "./useNow";

type Tool = Extract<ChatItem, { kind: "tool" }>;

// What the turn is doing now and for how long, from its items: the latest
// running step, else whether it's writing or thinking.
export function currentActivity(
  items: ChatItem[],
  state: ChatState
): { label: string; since?: number } | null {
  if (state === "waiting") return { label: "Waiting for your answer" };
  if (state !== "running") return null;
  const lastUser = items.findLast((i) => i.kind === "user");
  const tool = items.findLast(
    (i): i is Tool => i.kind === "tool" && i.status === "running"
  );
  if (tool) return { label: tool.title, since: tool.createdAt };
  const last = items.at(-1);
  const writing =
    last && (last.kind === "assistant" || last.kind === "reasoning");
  return {
    label:
      writing && last.streaming
        ? last.kind === "assistant"
          ? "Writing"
          : "Thinking"
        : "Working",
    since: lastUser?.createdAt,
  };
}

// One line above the composer while a turn runs, so a long wait never
// looks like nothing is happening.
export function ActivityLine({
  items,
  state,
  onStop,
}: {
  items: ChatItem[];
  state: ChatState;
  onStop: () => void;
}) {
  const activity = currentActivity(items, state);
  const now = useNow(!!activity?.since);
  if (!activity) return null;
  const waiting = state === "waiting";
  return (
    <div className="text-muted-foreground flex min-h-9 items-center gap-2 px-2 text-xs">
      {waiting ? (
        <MessageCircleQuestion className="text-primary h-3.5 w-3.5 shrink-0" />
      ) : (
        <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
      )}
      <span className="text-foreground/80 min-w-0 flex-1 truncate">
        {activity.label}
      </span>
      {activity.since && (
        <span className="shrink-0 font-mono tabular-nums">
          {formatElapsed(now - activity.since)}
        </span>
      )}
      {!waiting && (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop"
          className="hover:text-foreground hover:bg-foreground/[0.06] -my-1 flex h-11 shrink-0 items-center gap-1 rounded-md px-2 md:my-0 md:h-7"
        >
          <Square className="h-3 w-3 fill-current" />
          Stop
        </button>
      )}
    </div>
  );
}
