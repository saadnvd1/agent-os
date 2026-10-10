import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "@/lib/db";
import { projectKeys } from "../projects/keys";

export const workspaceKeys = {
  all: ["workspaces"] as const,
  list: () => [...workspaceKeys.all, "list"] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useWorkspacesQuery() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: async () =>
      (await json<{ workspaces: Workspace[] }>(await fetch("/api/workspaces")))
        .workspaces,
    staleTime: 30000,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (
        await json<{ workspace: Workspace }>(
          await fetch("/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          })
        )
      ).workspace,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      collapsed?: boolean;
      // Running tasks at once; null for no limit.
      maxRunningTasks?: number | null;
    }) =>
      json(
        await fetch(`/api/workspaces/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        })
      ),
    onMutate: async ({ id, maxRunningTasks, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKeys.list() });
      queryClient.setQueryData<Workspace[]>(workspaceKeys.list(), (prev) =>
        prev?.map((w) =>
          w.id === id
            ? {
                ...w,
                ...updates,
                ...(maxRunningTasks !== undefined && {
                  max_running_tasks: maxRunningTasks,
                }),
              }
            : w
        )
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      json(await fetch(`/api/workspaces/${id}`, { method: "DELETE" })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useMoveProjectToWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      workspaceId,
    }: {
      projectId: string;
      workspaceId: string | null;
    }) =>
      json(
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        })
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.all }),
  });
}
