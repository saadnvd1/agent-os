"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useDiscoveredTmuxQuery } from "@/data/hosts";
import { TmuxSessionRow } from "./TmuxSessionRow";
import { cn } from "@/lib/utils";

// tmux sessions outside every project folder, folded behind one label.
// Sessions inside a project are rendered by the project itself.
export function ElsewhereTmuxList() {
  const { data } = useDiscoveredTmuxQuery();
  const [open, setOpen] = useState(false);
  const sessions = (data?.sessions ?? []).filter((s) => s.projectId === null);
  if (sessions.length === 0) return null;

  return (
    <div className="pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-muted-foreground hover:text-foreground flex min-h-11 w-full items-center gap-1.5 px-2 text-left md:min-h-8"
      >
        <ChevronRight
          className={cn(
            "text-muted-foreground/60 h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="label-mono">Elsewhere</span>
        <span className="text-muted-foreground/50 font-mono text-[11px] tabular-nums">
          {sessions.length}
        </span>
      </button>
      {open &&
        sessions.map((s) => (
          <TmuxSessionRow key={`${s.hostId}:${s.name}`} session={s} showHost />
        ))}
    </div>
  );
}
