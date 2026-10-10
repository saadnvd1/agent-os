"use client";

import type { DiscoveredSession } from "@/lib/hosts/discover";
import {
  tmuxDisplayName,
  tmuxRowInfo,
  sessionRowInfo,
} from "@/lib/session-meta";
import { openBlockedReason } from "@/lib/hosts/open-reason";
import { tmuxAttachActions } from "@/stores/tmuxAttach";
import { StateDot } from "@/components/Projects/StateDot";
import {
  useDiscoveredTmuxQuery,
  useHostNames,
  useOpenPeerSession,
} from "@/data/hosts";
import { cn } from "@/lib/utils";
import { HostBadge } from "./HostBadge";

// A session agent-os didn't start here: a tmux session on any machine, or
// one a linked machine's AgentOS runs. State dot, name, what it's doing.
export function TmuxSessionRow({
  session,
  showHost = false,
}: {
  session: DiscoveredSession;
  showHost?: boolean;
}) {
  const { data } = useDiscoveredTmuxQuery();
  const hostNames = useHostNames();
  const open = useOpenPeerSession();
  const peer = session.peer;
  const info = peer
    ? sessionRowInfo(peer.state ?? undefined)
    : tmuxRowInfo(session.title);
  const blocked =
    openBlockedReason(session, data?.hostErrors, hostNames[session.hostId]) ??
    (open.error ? open.error.message : null);
  const subtitle =
    blocked ?? (peer ? (info.subtitle ?? peer.view) : info.subtitle);
  const onOpen = () => {
    if (open.isPending) return;
    if (peer) open.mutate({ hostId: session.hostId, sessionId: peer.id });
    else tmuxAttachActions.request(session.name, session.hostId);
  };
  // aria-disabled, not disabled: the reason stays readable on hover and focus.
  const disabled = !!blocked && !open.error;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onOpen}
      aria-disabled={disabled || open.isPending}
      title={blocked ?? session.path}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left md:min-h-8",
        disabled ? "cursor-not-allowed" : "hover:bg-foreground/[0.04]"
      )}
    >
      {/* Dimmed, but not the reason: it stays readable in both themes. */}
      <span
        className={cn(
          "flex w-2 shrink-0 justify-center",
          disabled && "opacity-60"
        )}
      >
        <StateDot state={info.state} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-1 leading-tight">
        <span className={cn("truncate text-sm", disabled && "opacity-60")}>
          {peer ? peer.name : tmuxDisplayName(session.name, session.path)}
        </span>
        {subtitle && (
          <span
            className={cn(
              "truncate text-[11px]",
              blocked
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground/70"
            )}
          >
            {open.isPending ? "Opening..." : subtitle}
          </span>
        )}
      </span>
      {showHost && <HostBadge hostId={session.hostId} />}
    </button>
  );
}
