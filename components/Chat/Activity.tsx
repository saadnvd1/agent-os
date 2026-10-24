"use client";

import {
  AlertTriangle,
  Loader2,
  MessageCircleQuestion,
  Shrink,
  Square,
} from "lucide-react";
import type {
  ChatItem,
  ChatState,
  Compacting,
  ModelWait,
} from "@/lib/chat/events";
import { formatTokens } from "@/lib/chat/context";
import { formatElapsed } from "@/lib/chat/elapsed";
import { currentActivity, type Phase } from "@/lib/chat/progress";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

export { currentActivity };

const PHASE: Record<Phase, string> = {
  planning: "Planning",
  coding: "Coding",
  testing: "Testing",
  error: "Error",
};

// Up to three lines above the composer while a turn runs, so a long wait
// never looks like nothing is happening: what it's doing and for how long,
// the phase and step count, and a hint when a model call drags on.
export function ActivityLine({
  items,
  state,
  compacting = null,
  modelWait = null,
  model,
  onStop,
}: {
  items: ChatItem[];
  state: ChatState;
  compacting?: Compacting | null;
  modelWait?: ModelWait | null;
  model?: string;
  onStop: () => void;
}) {
  const now = useNow(state === "running");
  const activity = currentActivity(
    items,
    state,
    compacting,
    modelWait,
    model,
    now
  );
  if (!activity) return null;
  const waiting = state === "waiting";
  const failed = activity.phase === "error" && activity.kind === "waiting";
  return (
    <div className="text-muted-foreground px-2 text-xs">
      <div className="flex min-h-9 items-center gap-2">
        {waiting ? (
          <MessageCircleQuestion className="text-primary h-3.5 w-3.5 shrink-0" />
        ) : activity.compacting ? (
          <Shrink className="h-3.5 w-3.5 shrink-0 animate-pulse text-blue-600 dark:text-blue-400" />
        ) : failed ? (
          <AlertTriangle className="text-destructive h-3.5 w-3.5 shrink-0" />
        ) : (
          <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
        )}
        <span className="text-foreground/80 min-w-0 flex-1 truncate">
          {activity.label}
        </span>
        {activity.tokens && (
          <span className="shrink-0 whitespace-nowrap">
            {formatTokens(activity.tokens)}+ tokens
          </span>
        )}
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
      {!waiting && activity.steps > 0 && activity.phase && (
        <div className="flex items-center gap-1.5 pb-1 pl-5 text-[11px]">
          <span
            className={cn(
              "shrink-0 font-medium",
              activity.phase === "error"
                ? "text-destructive"
                : "text-foreground/70"
            )}
          >
            {PHASE[activity.phase]}
          </span>
          <span className="shrink-0">
            · {activity.steps} {activity.steps === 1 ? "step" : "steps"}
          </span>
          {activity.lastStep && (
            <span className="min-w-0 flex-1 truncate">
              · {activity.lastStep}
            </span>
          )}
          {activity.turnSince && (
            <span className="ml-auto shrink-0 pl-2 font-mono tabular-nums">
              turn {formatElapsed(now - activity.turnSince)}
            </span>
          )}
        </div>
      )}
      {activity.hint && (
        <p className="pb-1.5 pl-5 text-[11px]">{activity.hint}</p>
      )}
    </div>
  );
}
