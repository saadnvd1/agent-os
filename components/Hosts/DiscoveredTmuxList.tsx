"use client";

import { SquareTerminal } from "lucide-react";
import { useDiscoveredTmuxQuery } from "@/data/hosts";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { HostBadge } from "./HostBadge";
import { cn } from "@/lib/utils";

interface DiscoveredTmuxListProps {
  // null lists sessions that don't belong to any project folder.
  projectId: string | null;
  title?: string;
}

export function DiscoveredTmuxList({
  projectId,
  title,
}: DiscoveredTmuxListProps) {
  const { data } = useDiscoveredTmuxQuery();
  const sessions = (data?.sessions ?? []).filter(
    (s) => s.projectId === projectId
  );
  if (sessions.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {title && (
        <p className="text-muted-foreground px-2 pt-3 pb-1 text-xs font-medium tracking-wide uppercase">
          {title}
        </p>
      )}
      {sessions.map((s) => (
        <button
          key={`${s.hostId}:${s.name}`}
          type="button"
          onClick={() => tmuxAttachActions.request(s.name, s.hostId)}
          title={s.path}
          className="hover:bg-muted/50 flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left md:min-h-8"
        >
          <SquareTerminal className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
          <HostBadge hostId={s.hostId} />
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              s.attached ? "bg-green-500" : "bg-muted-foreground/40"
            )}
            aria-label={s.attached ? "attached elsewhere" : "detached"}
          />
        </button>
      ))}
    </div>
  );
}
