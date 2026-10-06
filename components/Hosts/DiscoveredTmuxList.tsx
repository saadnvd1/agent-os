"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useDiscoveredTmuxQuery } from "@/data/hosts";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { HostBadge } from "./HostBadge";
import { cn } from "@/lib/utils";

interface DiscoveredTmuxListProps {
  // null lists sessions that don't belong to any project folder.
  projectId: string | null;
  title?: string;
}

// tmux sessions agent-os didn't start stay collapsed behind one quiet row so
// they don't compete with agent sessions.
export function DiscoveredTmuxList({
  projectId,
  title,
}: DiscoveredTmuxListProps) {
  const { data } = useDiscoveredTmuxQuery();
  const [open, setOpen] = useState(false);
  const sessions = (data?.sessions ?? []).filter(
    (s) => s.projectId === projectId
  );
  if (sessions.length === 0) return null;

  const label = title
    ? `${title} · ${sessions.length}`
    : `${sessions.length} tmux session${sessions.length === 1 ? "" : "s"}`;

  return (
    <div className={cn(title && "pt-3")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-muted-foreground/70 hover:text-muted-foreground flex min-h-11 w-full items-center gap-1.5 rounded-lg px-2 text-left text-xs md:min-h-7"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90"
          )}
        />
        <span className={cn(title && "label-mono")}>{label}</span>
      </button>
      {open &&
        sessions.map((s) => (
          <button
            key={`${s.hostId}:${s.name}`}
            type="button"
            onClick={() => tmuxAttachActions.request(s.name, s.hostId)}
            title={s.path}
            className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] flex min-h-11 w-full items-center gap-2.5 rounded-lg pr-2 pl-6 text-left md:min-h-8"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {s.name}
            </span>
            {projectId === null && <HostBadge hostId={s.hostId} />}
          </button>
        ))}
    </div>
  );
}
