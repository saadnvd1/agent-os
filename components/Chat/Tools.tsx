"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Check, ChevronRight, Loader2, Square, X } from "lucide-react";
import type { FileDiff, ToolBody } from "@/lib/chat/events";
import type { ToolItem } from "@/lib/chat/group";
import { lineDiff, shortPath, type DiffLine } from "@/lib/chat/diff";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/lib/chat/elapsed";
import { Highlighted } from "./Code";
import { useNow } from "./useNow";

// Output and diffs of tool calls sent without them (lib/chat/page), loaded
// when one is opened.
export const ToolBodies = createContext<{
  bodies: Record<string, ToolBody | null>;
  request: (id: string) => void;
}>({ bodies: {}, request: () => {} });

// A tool call's output and diff: its own, or once loaded. `undefined` while
// it loads.
export function useToolBody(tool: ToolItem): ToolBody | null | undefined {
  const { bodies, request } = useContext(ToolBodies);
  const body = tool.deferred ? bodies[tool.id] : tool;
  useEffect(() => {
    if (tool.deferred && body === undefined) request(tool.id);
  }, [tool.deferred, tool.id, body, request]);
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
        <pre className="text-muted-foreground max-h-64 overflow-auto rounded-lg px-2 font-mono text-[11px] whitespace-pre-wrap">
          {body.output}
        </pre>
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

function ToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(
    tool.status === "error" || !!tool.diff || !!tool.hasDiff
  );
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="hover:bg-foreground/[0.04] flex min-h-9 w-full items-center gap-2 rounded-lg px-1.5 text-left md:min-h-7"
      >
        <StatusIcon status={tool.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {tool.title}
        </span>
        <Elapsed tool={tool} />
      </button>
      {open && <ToolDetail tool={tool} />}
    </div>
  );
}

// A run of tool calls: one quiet line, expandable to every step.
export function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const running = tools.some((t) => t.status === "running");
  const failed = tools.filter((t) => t.status === "error").length;
  const stopped = tools.filter((t) => t.status === "stopped").length;
  const edits = tools.filter((t) => t.diff || t.hasDiff).length;
  const [open, setOpen] = useState(false);
  const latest =
    tools.findLast((t) => t.status === "running") ?? tools[tools.length - 1];
  return (
    <div className="bg-foreground/[0.025] rounded-xl px-2 py-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground flex min-h-10 w-full items-center gap-2 px-1.5 text-left text-xs md:min-h-8"
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
          {running
            ? latest.title
            : `${tools.length} step${tools.length === 1 ? "" : "s"}`}
          {!running && edits > 0 && ` · ${edits} edit${edits === 1 ? "" : "s"}`}
        </span>
        {running && <Elapsed tool={latest} />}
        {failed > 0 && (
          <span className="text-destructive">{failed} failed</span>
        )}
        {stopped > 0 && failed === 0 && (
          <span className="text-muted-foreground/70">stopped</span>
        )}
      </button>
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
