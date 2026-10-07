import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Session, Group } from "@/lib/db";
import type { AgentType } from "@/lib/providers";
import type { ChatAccess, ChatImage } from "@/lib/chat/events";
import { sessionKeys } from "./keys";

interface SessionsResponse {
  sessions: Session[];
  groups: Group[];
}

async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export function useSessionsQuery() {
  return useQuery({
    queryKey: sessionKeys.list(),
    queryFn: fetchSessions,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useRenameSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      newName,
    }: {
      sessionId: string;
      newName: string;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename session");
      return res.json();
    },
    onMutate: async ({ sessionId, newName }) => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.list() });
      const previous = queryClient.getQueryData<SessionsResponse>(
        sessionKeys.list()
      );
      queryClient.setQueryData<SessionsResponse>(sessionKeys.list(), (old) =>
        old
          ? {
              ...old,
              sessions: old.sessions.map((s) =>
                s.id === sessionId ? { ...s, name: newName } : s
              ),
            }
          : old
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useForkSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string): Promise<Session | null> => {
      const res = await fetch(`/api/sessions/${sessionId}/fork`, {
        method: "POST",
      });
      const data = await res.json();
      return data.session || null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useSummarizeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string): Promise<Session | null> => {
      const res = await fetch(`/api/sessions/${sessionId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createFork: true }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.newSession || null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useMoveSessionToGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      groupPath,
    }: {
      sessionId: string;
      groupPath: string;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupPath }),
      });
      if (!res.ok) throw new Error("Failed to move session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useMoveSessionToProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      projectId,
    }: {
      sessionId: string;
      projectId: string;
    }) => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("Failed to move session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export interface LaunchSessionInput {
  projectId: string | null;
  // A scratch chat's machine; a project's sessions run where it lives.
  hostId?: string;
  agentType: AgentType;
  model: string;
  access: ChatAccess;
  useWorktree: boolean;
  baseBranch: string | null;
  prompt: string;
  images?: ChatImage[];
}

interface LaunchSessionResponse {
  session: Session;
  initialPrompt?: string;
}

// A draft's first send: the session is made now, and shows in the list
// before its tab switches to it.
export function useLaunchSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: LaunchSessionInput
    ): Promise<LaunchSessionResponse> => {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error ?? "Couldn't start");
      return data;
    },
    onSuccess: ({ session }) => {
      queryClient.setQueryData<SessionsResponse>(sessionKeys.list(), (old) =>
        old && !old.sessions.some((s) => s.id === session.id)
          ? { ...old, sessions: [session, ...old.sessions] }
          : old
      );
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export interface SessionSetup {
  status: "running" | "ok" | "failed";
  stages: {
    id: string;
    label: string;
    state: "pending" | "running" | "ok" | "failed" | "skipped";
  }[];
  log: string[];
  branch: string | null;
  error: string | null;
  startedAt: number | null;
}

// A new session's worktree setup, polled while it runs.
export function useSessionSetup(sessionId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...sessionKeys.all, "setup", sessionId],
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/setup`);
      if (!res.ok) throw new Error("Couldn't read its setup");
      const { setup } = (await res.json()) as { setup: SessionSetup | null };
      // Its row says setup is over: the list catches up now, not in 10s.
      if (setup?.status !== "running")
        void queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      return setup;
    },
    refetchInterval: (q) =>
      q.state.status !== "error" &&
      (q.state.data === undefined || q.state.data?.status === "running")
        ? 1000
        : false,
  });
}
