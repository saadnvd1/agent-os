import { useState, useCallback, useEffect } from "react";
import type { Session } from "@/lib/db";
import type { SessionStatus } from "@/components/views/types";

interface UseSessionStatusesOptions {
  sessions: Session[];
  activeSessionId?: string | null;
  updatedSessionIds: React.MutableRefObject<Set<string>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  checkStateChanges: (
    states: Array<{ id: string; name: string; status: SessionStatus["status"] }>,
    activeSessionId?: string | null
  ) => void;
}

interface UseSessionStatusesReturn {
  sessionStatuses: Record<string, SessionStatus>;
  fetchStatuses: () => Promise<void>;
}

export function useSessionStatuses({
  sessions,
  activeSessionId,
  updatedSessionIds,
  setSessions,
  checkStateChanges,
}: UseSessionStatusesOptions): UseSessionStatusesReturn {
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});

  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions/status");
      const data = await res.json();
      const statuses = data.statuses || {};
      setSessionStatuses(statuses);

      // Check for notification-worthy state changes
      const sessionStates = sessions.map(s => ({
        id: s.id,
        name: s.name,
        status: (statuses[s.id]?.status || "dead") as SessionStatus["status"],
      }));
      checkStateChanges(sessionStates, activeSessionId);

      // Check for new Claude session IDs and update DB (only once per session)
      let needsRefresh = false;
      for (const [sessionId, status] of Object.entries(statuses) as [string, SessionStatus][]) {
        if (status.claudeSessionId && !updatedSessionIds.current.has(sessionId)) {
          updatedSessionIds.current.add(sessionId);
          await fetch(`/api/sessions/${sessionId}/claude-session`);
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        const sessRes = await fetch("/api/sessions");
        const sessData = await sessRes.json();
        setSessions(sessData.sessions || []);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (error instanceof TypeError && error.message === "Failed to fetch") return;
      console.error("Failed to fetch statuses:", error);
    }
  }, [sessions, activeSessionId, updatedSessionIds, setSessions, checkStateChanges]);

  // Poll for status every 3 seconds
  useEffect(() => {
    fetchStatuses();
    const interval = setInterval(fetchStatuses, 3000);
    return () => clearInterval(interval);
  }, [fetchStatuses]);

  return {
    sessionStatuses,
    fetchStatuses,
  };
}
