"use client";

import { createContext, useContext } from "react";
import { Check, ChevronRight, Layers, Loader2, X } from "lucide-react";
import type { ChatItem } from "@/lib/chat/events";
import type { ToolItem } from "@/lib/chat/group";
import { backgroundable } from "@/lib/chat/background";
import { formatElapsed } from "@/lib/chat/elapsed";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

type Task = Extract<ChatItem, { kind: "task" }>;

export interface BackgroundValue {
  // The agent can move a call to the background.
  supported: boolean;
  // The task a tool call started, by the call's id.
  taskOfTool: (toolUseId: string) => Task | undefined;
  taskById: (taskId: string) => Task | undefined;
  // Calls asked to move and not yet answered ("all" for the shortcut).
  moving: ReadonlySet<string>;
  send: (toolUseId?: string) => void;
  // Opens the tray on that task.
  reveal: (taskId: string) => void;
}

const none: BackgroundValue = {
  supported: false,
  taskOfTool: () => undefined,
  taskById: () => undefined,
  moving: new Set(),
  send: () => {},
  reveal: () => {},
};

export const Background = createContext<BackgroundValue>(none);
export const useBackground = () => useContext(Background);

// Moves the call it sits on to the background. Only there while that can
// work: after a few seconds of running, so quick commands never show it.
export function BackgroundButton({ tool }: { tool: ToolItem }) {
  const bg = useBackground();
  const running = tool.status === "running";
  const now = useNow(running && bg.supported);
  if (!backgroundable(bg.supported, tool, bg.taskOfTool(tool.id), now))
    return null;
  const moving = bg.moving.has(tool.id) || bg.moving.has("all");
  return (
    <button
      type="button"
      disabled={moving}
      onClick={(e) => {
        e.stopPropagation();
        bg.send(tool.id);
      }}
      title="Run in background (Ctrl+B)"
      aria-label="Run in background"
      className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] animate-in fade-in flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs duration-150 disabled:opacity-70 md:h-7 md:px-2"
    >
      {moving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Layers className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">
        {moving ? "Moving…" : "Background"}
      </span>
    </button>
  );
}

// Where a call that went to the background stands: running there (opens
// the tray on it), or how it ended.
export function BackgroundState({ tool }: { tool: ToolItem }) {
  const bg = useBackground();
  const task = tool.backgroundTaskId
    ? bg.taskById(tool.backgroundTaskId)
    : undefined;
  const running = task?.status === "running";
  const now = useNow(running);
  if (!tool.backgroundTaskId) return null;
  if (!task || running)
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          bg.reveal(tool.backgroundTaskId!);
        }}
        className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 text-[11px]"
      >
        in background
        <ChevronRight className="h-3 w-3" />
      </button>
    );
  const failed = task.status === "failed";
  const took = formatElapsed((task.endedAt ?? now) - task.createdAt);
  return (
    <span
      className={cn(
        "text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]",
        failed && "text-destructive"
      )}
    >
      {failed ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      {task.status === "stopped"
        ? "stopped in background"
        : failed
          ? "failed in background"
          : "ran in background"}
      <span className="font-mono tabular-nums">· {took}</span>
    </span>
  );
}
