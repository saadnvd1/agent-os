"use client";

import type { TmuxSessionInfo } from "@/lib/status-detector";
import { tmuxDisplayName, tmuxRowInfo } from "@/lib/session-meta";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { StateDot } from "@/components/Projects/StateDot";
import { HostBadge } from "./HostBadge";

// A tmux session agent-os didn't start: state dot, name, what it's doing.
export function TmuxSessionRow({
  session,
  showHost = false,
}: {
  session: TmuxSessionInfo;
  showHost?: boolean;
}) {
  const info = tmuxRowInfo(session.title);
  return (
    <button
      type="button"
      onClick={() => tmuxAttachActions.request(session.name, session.hostId)}
      title={session.path}
      className="hover:bg-foreground/[0.04] flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left md:min-h-8"
    >
      <span className="flex w-2 shrink-0 justify-center">
        <StateDot state={info.state} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-1 leading-tight">
        <span className="truncate text-sm">
          {tmuxDisplayName(session.name, session.path)}
        </span>
        {info.subtitle && (
          <span className="text-muted-foreground/70 truncate text-[11px]">
            {info.subtitle}
          </span>
        )}
      </span>
      {showHost && <HostBadge hostId={session.hostId} />}
    </button>
  );
}
