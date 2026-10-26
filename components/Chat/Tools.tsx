"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { Check, ChevronRight, Layers, Loader2, Square, X } from "lucide-react";
import type { FileDiff, ToolBody } from "@/lib/chat/events";
import type { ToolItem } from "@/lib/chat/group";
import { lineDiff, shortPath, type DiffLine } from "@/lib/chat/diff";
import { needsBody } from "@/lib/chat/bodyCache";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/chat/elapsed";
import { stepCounts, toolOutcome } from "@/lib/chat/tool-outcome";
import { stepSummary } from "@/lib/chat/step-summary";
import { StepOutcomes } from "./StepOutcomes";
import { Highlighted } from "./Code";
import { BackgroundButton, BackgroundState, useBackground } from "./background";
import { useNow } from "./useNow";
import { useRowState } from "./rowState";
import { BookmarkButton } from "@/components/Bookmarks/BookmarkButton";

// Output and diffs of tool calls sent without them (lib/chat/page), loaded
// when one is opened.
export const ToolBodies = createContext<{
  bodies: Record<string, ToolBody | null>;
  request: (id: string) => void;
  // Marks a body as on screen until the returned cleanup runs.
  pin: (id: string) => () => void;
  connected: boolean;
}>({ bodies: {}, request: () => {}, pin: () => () => {}, connected: false });

// A tool call's output and diff: its own, or once loaded. `undefined` while
// it loads.
export function useToolBody(tool: ToolItem): ToolBody | null | undefined {
  const { bodies, request, pin, connected } = useContext(ToolBodies);
  const body = tool.deferred ? bodies[tool.id] : tool;
  useEffect(() => {
    if (tool.deferred) return pin(tool.id);
  }, [tool.deferred, tool.id, pin]);
  useEffect(() => {
    if (needsBody(tool.deferred, body, connected)) request(tool.id);
  }, [tool.deferred, tool.id, body, request, connected]);
  return body;
}

export function StatusIcon({ status }: { status: ToolItem["status"] }) {
  if (status === "running")
    return (
      <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
    );
  if (status === "error")
    return <X className="text-destructive h-3.5 w-3.5 shrink-0" />;
  if (status === "stopped")
    return <Square className="text-muted-foreground/60 h-3 w-3 shrink-0" />;
  return <Check className="text-muted-foreground/70 h-3.5 w-3.5 shrink-0" />;
}

// The status of a call; one moved to the background and still running there
// shows as handed off instead of done.
export function ToolIcon({ tool }: { tool: ToolItem }) {
  const bg = useBackground();
  const task = tool.backgroundTaskId
    ? bg.taskById(tool.backgroundTaskId)
    : undefined;
  if (tool.backgroundTaskId && (!task || task.status === "running"))
    return <Layers className="text-muted-foreground h-3.5 w-3.5 shrink-0" />;
  return <StatusIcon status={tool.status} />;
}

const TONE: Record<DiffLine["op"], string> = {
  " ": "text-muted-foreground",
  "-": "bg-red-500/10 text-red-700 dark:text-red-300",
  "+": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function DiffView({ diff }: { diff: FileDiff }) {
  return (
    <div className="overflow-x-auto rounded-lg font-mono text-[11px] leading-5">
      <div className="text-muted-foreground bg-foreground/[0.04] px-2 py-1">
        {shortPath(diff.path)}
      </div>
      {lineDiff(diff.before, diff.after).map((l, i) => (
        <div key={i} className={cn("px-2 whitespace-pre-wrap", TONE[l.op])}>
          <span className="mr-2 opacity-60 select-none">{l.op}</span>
          {l.text}
        </div>
      ))}
    </div>
  );
}

// What a tool call does: its diff, its command, or its raw input.
export function ToolPreview({
  name,
  input,
  diff,
}: {
  name: string;
  input: unknown;
  diff?: FileDiff;
}) {
  const i = input as Record<string, unknown> | null;
  if (diff) return <DiffView diff={diff} />;
  if (name === "Bash" && typeof i?.command === "string")
    return (
      <div className="bg-foreground/[0.04] overflow-x-auto rounded-lg px-2 py-1.5 font-mono text-[11px] leading-5">
        <Highlighted code={i.command} language="bash" />
      </div>
    );
  return (
    <pre className="bg-foreground/[0.04] max-h-40 overflow-auto rounded-lg px-2 py-1.5 font-mono text-[11px]">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

// A step's output. While it runs the view follows the end, unless the
// reader scrolled up to read.
export function LiveOutput({
  text,
  running,
}: {
  text: string;
  running: boolean;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (running && el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, running]);
  return (
    <pre
      ref={ref}
      data-testid="tool-output"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="text-muted-foreground max-h-64 overflow-auto rounded-lg px-2 font-mono text-[11px] whitespace-pre-wrap"
    >
      {text}
    </pre>
  );
}

function ToolDetail({ tool }: { tool: ToolItem }) {
  const body = useToolBody(tool);
  if (body === undefined && tool.hasDiff)
    return (
      <div className="pb-2 pl-6">
        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
      </div>
    );
  return (
    <div className="space-y-2 pb-2 pl-6">
      <ToolPreview name={tool.name} input={tool.input} diff={body?.diff} />
      {body?.output && !body.diff && (
        <LiveOutput text={body.output} running={tool.status === "running"} />
      )}
      {body === undefined && tool.hasOutput && (
        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
      )}
    </div>
  );
}

// How long a step has run, or took once it's done (only when it's long
// enough to matter).
function Elapsed({ tool }: { tool: ToolItem }) {
  const running = tool.status === "running";
  const now = useNow(running);
  const ms = (running ? now : (tool.endedAt ?? 0)) - tool.createdAt;
  if (!running && (!tool.endedAt || ms < 3000)) return null;
  return (
    <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
      {formatElapsed(ms)}
    </span>
  );
}

// A running step that has printed something: its output shows as it comes.
const streaming = (tool: ToolItem) =>
  tool.status === "running" && !!tool.output && !tool.deferred;

function ToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useRowState(
    `tool:${tool.id}`,
    tool.status === "error" || !!tool.diff || !!tool.hasDiff
  );
  return (
    <div data-item={tool.id}>
      <div className="group hover:bg-foreground/[0.04] flex items-center gap-1 rounded-lg pr-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-1.5 text-left md:min-h-7"
        >
          <ToolIcon tool={tool} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {tool.title}
          </span>
          {toolOutcome(tool) && (
            <span
              className={cn(
                "shrink-0 font-mono text-[11px]",
                tool.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {toolOutcome(tool)}
            </span>
          )}
          {tool.backgroundTaskId ? (
            <BackgroundState tool={tool} />
          ) : (
            <Elapsed tool={tool} />
          )}
        </button>
        <BackgroundButton tool={tool} />
        <BookmarkButton itemId={tool.id} />
      </div>
      {(open || streaming(tool)) && <ToolDetail tool={tool} />}
    </div>
  );
}

// A run of tool calls: one quiet line, expandable to every step.
export function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const running = tools.some((t) => t.status === "running");
  const { ok, failed, stopped } = stepCounts(tools);
  const moved = tools.filter((t) => t.backgroundTaskId).length;
  const [open, setOpen] = useRowState(`steps:${tools[0].id}`, false);
  const latest =
    tools.findLast((t) => t.status === "running") ?? tools[tools.length - 1];
  return (
    <div className="bg-foreground/[0.025] rounded-xl px-2 py-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-muted-foreground hover:text-foreground flex min-h-10 min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-xs md:min-h-8"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 transition-transform",
              open && "rotate-90"
            )}
          />
          {running ? (
            <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            {running ? latest.title : stepSummary(tools)}
            {!running && (failed > 0 || stopped > 0) && ` · ${ok} ok`}
          </span>
          {running && <Elapsed tool={latest} />}
          {failed > 0 && (
            <span className="text-destructive">{failed} failed</span>
          )}
          {stopped > 0 && (
            <span className="text-muted-foreground/70">{stopped} not run</span>
          )}
          {!running && moved > 0 && (
            <span className="text-muted-foreground/70">
              {moved} in background
            </span>
          )}
        </button>
        {running && <BackgroundButton tool={latest} />}
      </div>
      {!open && !running && (
        <StepOutcomes tools={tools} onOpen={() => setOpen(true)} />
      )}
      {!open && streaming(latest) && (
        <div className="pb-1">
          <ToolDetail tool={latest} />
        </div>
      )}
      {open && (
        <div className="pb-1">
          {tools.map((t) => (
            <ToolRow key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}
