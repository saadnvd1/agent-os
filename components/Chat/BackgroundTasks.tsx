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
import { outputTail } from "@/lib/chat/background";
import { formatElapsed } from "@/lib/chat/elapsed";
import { cn } from "@/lib/utils";
import { useNow } from "./useNow";

type Task = Extract<ChatItem, { kind: "task" }>;

// Finished tasks stay listed this long, then the chip clears.
const RECENT_MS = 5 * 60 * 1000;
const POLL_MS = 2000;
// Running tasks whose last line of output is followed while the tray is open.
const TAILED = 5;

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
  tail,
  highlight,
  onStop,
  onLoadOutput,
}: {
  task: Task;
  now: number;
  output: string | null | undefined;
  // Follows its output for the line under its name.
  tail: boolean;
  // Brought here from the call it came from.
  highlight: boolean;
  onStop: () => void;
  onLoadOutput: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(highlight);
  const rowRef = useRef<HTMLDivElement>(null);
  const running = task.status === "running";
  const { taskId } = task;
  const outputRef = useRef<HTMLPreElement>(null);

  // Follow the newest output, like a terminal.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (!highlight) return;
    setOpen(true);
    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight]);

  // While open (or tailed), keep the output fresh for as long as it runs.
  useEffect(() => {
    if (!open && !(tail && running)) return;
    onLoadOutput(taskId);
    if (!running) return;
    const t = setInterval(() => onLoadOutput(taskId), POLL_MS);
    return () => clearInterval(t);
  }, [open, tail, running, taskId, onLoadOutput]);

  const took = formatElapsed((task.endedAt ?? now) - task.createdAt);
  const line =
    running && !open ? (outputTail(output) ?? task.lastToolName) : null;
  return (
    <div
      ref={rowRef}
      className={cn(
        "rounded-lg transition-colors duration-700",
        highlight && "bg-foreground/[0.05]"
      )}
    >
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
      {line && (
        <p className="text-muted-foreground truncate pr-2 pb-1.5 pl-9 font-mono text-[11px]">
          {line}
        </p>
      )}
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
  reveal,
  onStop,
  onLoadOutput,
}: {
  items: ChatItem[];
  // A task to open the tray on, from the call that became it.
  reveal?: { taskId: string; at: number } | null;
  outputs: Record<string, string | null>;
  onStop: (taskId: string) => void;
  onLoadOutput: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  // One still blocking its call isn't in the background yet.
  const tasks = items.filter(
    (i): i is Task => i.kind === "task" && i.backgrounded !== false
  );
  const running = tasks.filter((t) => t.status === "running" && !t.ambient);
  const now = useNow(running.length > 0);
  const shown = tasks
    .filter((t) => t.status === "running" || now - (t.endedAt ?? 0) < RECENT_MS)
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        b.createdAt - a.createdAt
    );
  const failed = shown.filter((t) => t.status === "failed").length;

  // A task arriving gives the chip one soft pulse.
  const count = running.length;
  const seen = useRef(count);
  useEffect(() => {
    const more = count > seen.current;
    seen.current = count;
    if (!more) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 700);
    return () => clearTimeout(t);
  }, [count]);

  // Asked to show a task: open the tray on it for a moment.
  useEffect(() => {
    if (!reveal) return;
    setOpen(true);
    setLit(reveal.taskId);
    const t = setTimeout(() => setLit(null), 1200);
    return () => clearTimeout(t);
  }, [reveal]);

  if (!shown.length) return null;

  return (
    <div className="px-1 pb-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors duration-500 md:h-7",
          running.length && "text-primary",
          !running.length && failed > 0 && "text-destructive",
          pulse && "bg-foreground/[0.08]"
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        {running.length
          ? `${running.length} running in background`
          : failed
            ? `${failed} failed in background`
            : `${shown.length} finished in background`}
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="bg-foreground/[0.025] mt-1 max-h-80 overflow-y-auto rounded-xl px-1 py-1">
          {shown.map((t, i) => (
            <TaskRow
              key={t.id}
              task={t}
              tail={i < TAILED}
              highlight={lit === t.taskId}
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
