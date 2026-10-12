import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LogHeader } from "@/lib/session-logs/store";

export type { LogHeader };

export const sessionLogKeys = {
  all: ["session-logs"] as const,
  task: (id: string) => [...sessionLogKeys.all, "task", id] as const,
  project: (id: string) => [...sessionLogKeys.all, "project", id] as const,
};

export interface TaskLog {
  header: LogHeader;
  markdown: string;
}

export interface ProjectLogs {
  folder: string | null;
  defaultFolder: string;
  logs: LogHeader[];
}

// null: this task has no log (it didn't merge, or it predates logs).
export function useTaskLogQuery(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: sessionLogKeys.task(sessionId ?? ""),
    queryFn: async (): Promise<TaskLog | null> => {
      const res = await fetch(
        `/api/session-logs/${encodeURIComponent(sessionId!)}`
      );
      if (res.status === 404) return null;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    },
    enabled: enabled && !!sessionId,
    // A written log doesn't change; a task that just merged may not have
    // one for a moment.
    staleTime: (query) => (query.state.data ? Infinity : 10_000),
  });
}

async function projectLogs(res: Response): Promise<ProjectLogs> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useProjectLogsQuery(projectId: string, enabled = true) {
  return useQuery({
    queryKey: sessionLogKeys.project(projectId),
    queryFn: async () =>
      projectLogs(await fetch(`/api/projects/${projectId}/session-logs`)),
    enabled,
    staleTime: 30_000,
  });
}

export function useSetLogFolder(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (folder: string) =>
      projectLogs(
        await fetch(`/api/projects/${projectId}/session-logs`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder }),
        })
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(sessionLogKeys.project(projectId), data),
  });
}
