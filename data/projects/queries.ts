import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectWithDevServers } from "@/lib/projects";
import { projectKeys } from "./keys";
import { sessionKeys } from "../sessions/keys";

async function fetchProjects(): Promise<ProjectWithDevServers[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data = await res.json();
  return data.projects || [];
}

export function useProjectsQuery() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: fetchProjects,
    staleTime: 30000,
  });
}

export function useToggleProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      expanded,
    }: {
      projectId: string;
      expanded: boolean;
    }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded }),
      });
      if (!res.ok) throw new Error("Failed to toggle project");
      return res.json();
    },
    onMutate: async ({ projectId, expanded }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.list() });
      const previous = queryClient.getQueryData<ProjectWithDevServers[]>(
        projectKeys.list()
      );
      queryClient.setQueryData<ProjectWithDevServers[]>(
        projectKeys.list(),
        (old) => old?.map((p) => (p.id === projectId ? { ...p, expanded } : p))
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectKeys.list(), context.previous);
      }
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      newName,
    }: {
      projectId: string;
      newName: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      name,
      workingDirectory,
      agentType,
      defaultModel,
    }: {
      projectId: string;
      name?: string;
      workingDirectory?: string;
      agentType?: string;
      defaultModel?: string;
    }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          workingDirectory,
          agentType,
          defaultModel,
        }),
      });
      if (!res.ok) throw new Error("Failed to update project");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      workingDirectory: string;
      agentType?: string;
      defaultModel?: string;
      devServers?: Array<{
        name: string;
        type: string;
        command: string;
        port?: number;
        portEnvVar?: string;
      }>;
    }) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create project");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}
