"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Eye,
  Layers,
  Loader2,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import type { ChatItem } from "@/lib/chat/events";
import { formatElapsed } from "@/lib/chat/elapsed";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

type Task = Extract<ChatItem, { kind: "task" }>;

// Finished tasks stay listed this long, then the chip clears.
const RECENT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;

function TaskIcon({ task }: { task: Task }) {
  if (task.status === "running")
    return (
      <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
    );
  if (task.status === "failed")
    return <X className="text-destructive h-3.5 w-3.5 shrink-0" />;
  if (task.status === "stopped")
    return <Square className="text-muted-foreground h-3 w-3 shrink-0" />;
  return <Check className="text-muted-foreground h-3.5 w-3.5 shrink-0" />;
}

function KindIcon({ task }: { task: Task }) {
  const type = task.taskType ?? "";
  const Icon = /agent/.test(type)
    ? Bot
    : /monitor|watch/.test(type)
      ? Eye
      : SquareTerminal;
  return <Icon className="text-muted-foreground h-3.5 w-3.5 shrink-0" />;
}

function TaskRow({
  task,
  now,
  output,
  onStop,
  onLoadOutput,
}: {
  task: Task;
  now: number;
  output: string | null | undefined;
  onStop: () => void;
  onLoadOutput: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const running = task.status === "running";
  const { taskId } = task;
  const outputRef = useRef<HTMLPreElement>(null);

  // Follow the newest output, like a terminal.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  // While open, keep the output fresh for as long as the task runs.
  useEffect(() => {
    if (!open) return;
    onLoadOutput(taskId);
    if (!running) return;
    const t = setInterval(() => onLoadOutput(taskId), POLL_MS);
    return () => clearInterval(t);
  }, [open, running, taskId, onLoadOutput]);

  const took = formatElapsed((task.endedAt ?? now) - task.createdAt);
  return (
    <div className="rounded-lg">
      <div className="flex min-h-11 items-center gap-2 px-1.5 md:min-h-9">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              "text-muted-foreground h-3 w-3 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
          <KindIcon task={task} />
          <span className="min-w-0 flex-1 truncate text-xs">
            {task.description}
          </span>
          <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
            {took}
          </span>
          <TaskIcon task={task} />
        </button>
        {running && (
          <button
            type="button"
            onClick={onStop}
            aria-label={`Stop ${task.description}`}
            className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] flex h-9 shrink-0 items-center rounded-md px-2 text-xs md:h-7"
          >
            Stop
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-1 pb-2 pl-7">
          {task.summary && task.summary !== task.description && (
            <p className="text-muted-foreground text-xs">{task.summary}</p>
          )}
          {output === undefined ? (
            <p className="text-muted-foreground text-xs">Loading output…</p>
          ) : output ? (
            <pre
              ref={outputRef}
              className="bg-foreground/[0.04] max-h-56 overflow-auto rounded-lg px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap"
            >
              {output}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">
              {running ? "No output yet." : "No output."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Work the agent runs alongside the turn: a chip in the composer that opens
// a list of each task, how long it's been going, its output, and Stop.
export function BackgroundTasks({
  items,
  outputs,
  onStop,
  onLoadOutput,
}: {
  items: ChatItem[];
  outputs: Record<string, string | null>;
  onStop: (taskId: string) => void;
  onLoadOutput: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tasks = items.filter((i): i is Task => i.kind === "task");
  const running = tasks.filter((t) => t.status === "running" && !t.ambient);
  const now = useNow(running.length > 0);
  const shown = tasks
    .filter((t) => t.status === "running" || now - (t.endedAt ?? 0) < RECENT_MS)
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        b.createdAt - a.createdAt
    );
  if (!shown.length) return null;

  return (
    <div className="px-1 pb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs md:h-7",
          running.length && "text-primary"
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        {running.length
          ? `${running.length} running in background`
          : `${shown.length} background task${shown.length === 1 ? "" : "s"}`}
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="bg-foreground/[0.025] mt-1 max-h-80 overflow-y-auto rounded-xl px-1 py-1">
          {shown.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              now={now}
              output={outputs[t.taskId]}
              onStop={() => onStop(t.taskId)}
              onLoadOutput={onLoadOutput}
            />
          ))}
        </div>
      )}
    </div>
  );
}
