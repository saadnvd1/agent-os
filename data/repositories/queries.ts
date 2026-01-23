import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectRepository } from "@/lib/db";
import { repositoryKeys } from "./keys";
import { projectKeys } from "@/data/projects/keys";

async function fetchProjectRepositories(
  projectId: string
): Promise<ProjectRepository[]> {
  const res = await fetch(`/api/projects/${projectId}/repositories`);
  if (!res.ok) throw new Error("Failed to fetch repositories");
  const data = await res.json();
  return data.repositories || [];
}

export function useProjectRepositories(projectId: string | undefined) {
  return useQuery({
    queryKey: repositoryKeys.list(projectId || ""),
    queryFn: () => fetchProjectRepositories(projectId!),
    enabled: !!projectId,
    staleTime: 30000,
  });
}

interface AddRepositoryOptions {
  projectId: string;
  name: string;
  path: string;
  isPrimary?: boolean;
}

export function useAddRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts: AddRepositoryOptions) => {
      const res = await fetch(`/api/projects/${opts.projectId}/repositories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: opts.name,
          path: opts.path,
          isPrimary: opts.isPrimary,
        }),
      });
      if (!res.ok) throw new Error("Failed to add repository");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: repositoryKeys.list(variables.projectId),
      });
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

interface UpdateRepositoryOptions {
  projectId: string;
  repoId: string;
  name?: string;
  path?: string;
  isPrimary?: boolean;
  sortOrder?: number;
}

export function useUpdateRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts: UpdateRepositoryOptions) => {
      const res = await fetch(
        `/api/projects/${opts.projectId}/repositories/${opts.repoId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: opts.name,
            path: opts.path,
            isPrimary: opts.isPrimary,
            sortOrder: opts.sortOrder,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to update repository");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: repositoryKeys.list(variables.projectId),
      });
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

interface DeleteRepositoryOptions {
  projectId: string;
  repoId: string;
}

export function useDeleteRepository() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts: DeleteRepositoryOptions) => {
      const res = await fetch(
        `/api/projects/${opts.projectId}/repositories/${opts.repoId}`,
        {
          method: "DELETE",
        }
      );
      if (!res.ok) throw new Error("Failed to delete repository");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: repositoryKeys.list(variables.projectId),
      });
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}
