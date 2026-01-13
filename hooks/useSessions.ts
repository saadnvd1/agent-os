import { useState, useCallback, useRef } from "react";
import type { Session, Group } from "@/lib/db";

interface UseSessionsReturn {
  sessions: Session[];
  groups: Group[];
  summarizingSessionId: string | null;
  setSummarizingSessionId: (id: string | null) => void;
  fetchSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, newName: string) => Promise<void>;
  forkSession: (sessionId: string) => Promise<Session | null>;
  summarizeSession: (sessionId: string) => Promise<Session | null>;
  moveSessionToGroup: (sessionId: string, groupPath: string) => Promise<void>;
  moveSessionToProject: (sessionId: string, projectId: string) => Promise<void>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  updatedSessionIds: React.MutableRefObject<Set<string>>;
}

export function useSessions(): UseSessionsReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [summarizingSessionId, setSummarizingSessionId] = useState<string | null>(null);
  const updatedSessionIds = useRef<Set<string>>(new Set());

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
      setGroups(data.groups || []);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (error instanceof TypeError && error.message === "Failed to fetch") return;
      console.error("Failed to fetch sessions:", error);
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to delete session:", error);
    }
  }, [fetchSessions]);

  const renameSession = useCallback(async (sessionId: string, newName: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to rename session:", error);
    }
  }, [fetchSessions]);

  const forkSession = useCallback(async (sessionId: string): Promise<Session | null> => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/fork`, { method: "POST" });
      const data = await res.json();
      if (data.session) {
        await fetchSessions();
        return data.session;
      }
    } catch (error) {
      console.error("Failed to fork session:", error);
    }
    return null;
  }, [fetchSessions]);

  const summarizeSession = useCallback(async (sessionId: string): Promise<Session | null> => {
    setSummarizingSessionId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createFork: true }),
      });
      const data = await res.json();
      if (data.error) {
        console.error("Summarize failed:", data.error);
        return null;
      }
      if (data.newSession) {
        await fetchSessions();
        return data.newSession;
      }
    } catch (error) {
      console.error("Failed to summarize session:", error);
    } finally {
      setSummarizingSessionId(null);
    }
    return null;
  }, [fetchSessions]);

  const moveSessionToGroup = useCallback(async (sessionId: string, groupPath: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupPath }),
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to move session:", error);
    }
  }, [fetchSessions]);

  const moveSessionToProject = useCallback(async (sessionId: string, projectId: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      await fetchSessions();
    } catch (error) {
      console.error("Failed to move session to project:", error);
    }
  }, [fetchSessions]);

  return {
    sessions,
    groups,
    summarizingSessionId,
    setSummarizingSessionId,
    fetchSessions,
    deleteSession,
    renameSession,
    forkSession,
    summarizeSession,
    moveSessionToGroup,
    moveSessionToProject,
    setSessions,
    setGroups,
    updatedSessionIds,
  };
}
