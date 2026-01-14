import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";
import { sessionKeys, statusKeys } from "../sessions/keys";

interface StatusResponse {
  statuses: Record<string, SessionStatus>;
}

async function fetchStatuses(): Promise<StatusResponse> {
  const res = await fetch("/api/sessions/status");
  if (!res.ok) throw new Error("Failed to fetch statuses");
  return res.json();
}

interface UseSessionStatusesOptions {
  sessions: Session[];
  activeSessionId?: string | null;
  checkStateChanges: (
    states: Array<{
      id: string;
      name: string;
      status: SessionStatus["status"];
    }>,
    activeSessionId?: string | null
  ) => void;
}

export function useSessionStatusesQuery({
  sessions,
  activeSessionId,
  checkStateChanges,
}: UseSessionStatusesOptions) {
  const queryClient = useQueryClient();
  const updatedSessionIds = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
    refetchInterval: (query) => {
      const statuses = query.state.data?.statuses;
      if (!statuses) return 5000;

      const hasActive = Object.values(statuses).some(
        (s) => s.status === "running" || s.status === "waiting"
      );

      return hasActive ? 5000 : 30000;
    },
  });

  useEffect(() => {
    if (!query.data?.statuses) return;

    const statuses = query.data.statuses;

    const sessionStates = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      status: (statuses[s.id]?.status || "dead") as SessionStatus["status"],
    }));
    checkStateChanges(sessionStates, activeSessionId);

    (async () => {
      let needsRefresh = false;
      for (const [sessionId, status] of Object.entries(statuses) as [
        string,
        SessionStatus,
      ][]) {
        if (
          status.claudeSessionId &&
          !updatedSessionIds.current.has(sessionId)
        ) {
          updatedSessionIds.current.add(sessionId);
          await fetch(`/api/sessions/${sessionId}/claude-session`);
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      }
    })();
  }, [query.data, sessions, activeSessionId, checkStateChanges, queryClient]);

  return {
    sessionStatuses: query.data?.statuses ?? {},
    isLoading: query.isLoading,
  };
}
