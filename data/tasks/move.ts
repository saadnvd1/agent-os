"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MoveProgress } from "@/lib/tasks/move-progress";
import {
  moveTargets,
  type Movable,
  type MoveTarget,
} from "@/lib/tasks/move-targets";
import { moveUiActions } from "@/stores/moveUi";
import { useHostNames, useLinkedHosts } from "../hosts";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "./keys";

/** The moves this task can make right now, the same in every menu. */
export function useMoveTargets(m: Movable | null): MoveTarget[] {
  const machines = useLinkedHosts();
  return m ? moveTargets(m, machines) : [];
}

/**
 * Starts a move and hands it to MoveDialog, which shows its steps and how it
 * ended. Safe to call from a menu that closes straight after: nothing here
 * depends on the caller staying mounted.
 */
export function useMoveSession() {
  const queryClient = useQueryClient();
  const names = useHostNames();
  return useCallback(
    async (
      s: { id: string; name: string; hostId: string | null },
      t: MoveTarget
    ) => {
      const here = !s.hostId || s.hostId === "local";
      const started = moveUiActions.start({
        sessionId: s.id,
        name: s.name,
        from: here ? "this machine" : (names[s.hostId!] ?? "the other machine"),
        to: t.name,
        toHostId: t.hostId,
      });
      if (!started) return;
      // A finished earlier move of it mustn't read as this one's end.
      queryClient.removeQueries({ queryKey: taskKeys.move(s.id) });
      try {
        const res = await fetch(`/api/tasks/${s.id}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId: t.hostId }),
        });
        const data = await res.json().catch(() => null);
        // Not AgentOS answering (a proxy's page): the move may still go on.
        if (!data) throw new Error("no answer");
        moveUiActions.settle(
          s.id,
          res.ok
            ? {
                phase: "done",
                error: null,
                arrivedId: data.session?.id ?? null,
              }
            : {
                phase: "failed",
                error: data.error || "The move failed",
                arrivedId: null,
              }
        );
      } catch {
        moveUiActions.settle(s.id, {
          phase: "lost",
          error: null,
          arrivedId: null,
        });
      } finally {
        queryClient.invalidateQueries({ queryKey: taskKeys.all });
        queryClient.invalidateQueries({ queryKey: sessionKeys.all });
      }
    },
    [queryClient, names]
  );
}

/** The server's word on how far a move has got, polled while it runs. */
export function useMoveProgress(sessionId: string | null, polling: boolean) {
  return useQuery({
    queryKey: taskKeys.move(sessionId ?? ""),
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${sessionId}/move`);
      if (!res.ok) throw new Error("Couldn't read the move's progress");
      return ((await res.json()) as { progress: MoveProgress | null }).progress;
    },
    enabled: !!sessionId,
    refetchInterval: polling ? 1000 : false,
  });
}
