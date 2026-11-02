"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { leadKeys, useDirectionAction, useLeadDirection } from "@/data/leads";
import type { DirectionChat } from "./direction-context";

// The direction of a standing chat, or null when it has none (the server
// answers null with Leads off: the experiment is unlisted, so the client's
// list doesn't carry it). Proposals and memos arrive from the lead's tool
// calls, so it reloads when a turn ends.
export function useDirection(
  sessionId: string,
  standing: boolean,
  state: string | null | undefined
): DirectionChat | null {
  const on = standing;
  const { data: view } = useLeadDirection(sessionId, on);
  const act = useDirectionAction(sessionId);
  const qc = useQueryClient();
  const was = useRef(state);
  useEffect(() => {
    const ended = was.current !== "idle" && state === "idle";
    was.current = state;
    if (on && ended)
      void qc.invalidateQueries({ queryKey: leadKeys.direction(sessionId) });
  }, [on, state, sessionId, qc]);
  const { mutate, isPending } = act;
  return useMemo(() => {
    if (!view) return null;
    const run = (a: Parameters<typeof mutate>[0]) =>
      mutate(a, { onError: (e) => toast.error(e.message) });
    return {
      view,
      pin: (itemId) => run({ action: "pin", itemId }),
      answer: (proposalId, pin) => run({ action: "proposal", proposalId, pin }),
      busy: isPending,
    };
  }, [view, mutate, isPending]);
}
