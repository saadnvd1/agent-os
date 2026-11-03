"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { usePanes } from "@/contexts/PaneContext";
import {
  useSessionAnalyst,
  useStartAnalyst,
  type StartAnalystInput,
} from "@/data/analyst";
import type { Session } from "@/lib/db";
import type { AnalystLinkView, PaneSession } from "@/lib/analyst/types";

// A chat's tmux name: `<agent>-<id>`, as every chat tab attaches.
export const paneTmux = (s: PaneSession) => `${s.agentType}-${s.id}`;

export type PairStatus = "paused" | "reviewing" | "recommendation" | "watching";

export function pairStatus(link: AnalystLinkView): PairStatus {
  if (link.paused) return "paused";
  if (link.pendingDigestId) return "reviewing";
  if (link.recommendations.some((r) => r.state === "open"))
    return "recommendation";
  return "watching";
}

export const PAIR_STATUS_LABEL: Record<PairStatus, string> = {
  paused: "Paused",
  reviewing: "Reviewing",
  recommendation: "Prompt ready",
  watching: "Watching",
};

// The side of a pairing a session isn't.
export function partnerOf(link: AnalystLinkView, sessionId: string) {
  return link.coder.id === sessionId ? link.analyst : link.coder;
}

// Starts an analyst for a chat and shows it beside the coder's pane: the
// one given, else one showing the coder, else the focused one.
export function useStartAnalystBeside() {
  const start = useStartAnalyst();
  const { openBeside, state, focusedPaneId } = usePanes();
  const run = useCallback(
    async (input: StartAnalystInput, paneId?: string) => {
      try {
        const link = await start.mutateAsync(input);
        const showing = Object.entries(state.panes).find(([, p]) =>
          p.tabs.some(
            (t) => t.id === p.activeTabId && t.sessionId === link.coder.id
          )
        )?.[0];
        openBeside(paneId ?? showing ?? focusedPaneId, {
          sessionId: link.analyst.id,
          tmux: paneTmux(link.analyst),
        });
        return link;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [start, openBeside, state.panes, focusedPaneId]
  );
  return { run, isPending: start.isPending };
}

// Whether a session can be given an analyst here: a local chat that isn't
// an orchestrator, an analyst or already paired. The server checks again.
export function useCanAddAnalyst(session: Session | null | undefined) {
  const chat = session?.view === "chat" ? session : null;
  const paired = useSessionAnalyst(chat?.id).data;
  return (
    !!chat &&
    !chat.role &&
    !chat.archived_at &&
    (chat.host_id || "local") === "local" &&
    chat.agent_role !== "analyst" &&
    !paired
  );
}
