"use client";

import { useState } from "react";
import { Bot, ChevronRight } from "lucide-react";
import type { ToolItem } from "@/lib/chat/group";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { StatusIcon } from "./Tools";

// Work handed to a subagent: what it was asked, and its report when done.
export function SubagentCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const input = (item.input ?? {}) as {
    subagent_type?: string;
    prompt?: string;
  };
  const report = item.output?.trim();
  return (
    <div className="bg-foreground/[0.025] rounded-xl px-2 py-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-10 w-full items-center gap-2 px-1.5 text-left text-xs md:min-h-8"
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <Bot className="text-primary h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {input.subagent_type && (
          <span className="text-muted-foreground hidden font-mono sm:inline">
            {input.subagent_type}
          </span>
        )}
        <StatusIcon status={item.status} />
      </button>
      {open && (
        <div className="space-y-3 px-1.5 pt-1 pb-2 pl-7">
          {input.prompt && (
            <p className="text-muted-foreground line-clamp-6 text-xs whitespace-pre-wrap">
              {input.prompt}
            </p>
          )}
          {report && <Markdown text={report} />}
        </div>
      )}
    </div>
  );
}
