import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MergeMethod,
  MergePolicy,
  MergeSettings,
  ResolvedMergePolicy,
} from "@/lib/tasks/merge-methods";

export const mergeKeys = {
  all: ["merge-settings"] as const,
  global: () => [...mergeKeys.all, "global"] as const,
  project: (id: string) => [...mergeKeys.all, "project", id] as const,
};

export interface GlobalMergeState {
  settings: MergeSettings;
  defaults: MergePolicy;
}

export interface ProjectMergeState {
  settings: MergeSettings;
  config: MergeSettings;
  global: MergeSettings;
  // Without the project's own setting.
  inherited: ResolvedMergePolicy;
  effective: ResolvedMergePolicy;
  // What the repository allows; null when GitHub couldn't say.
  allowed: MergeMethod[] | null;
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const put = (url: string, settings: MergeSettings) =>
  fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });

export function useGlobalMergeSettings(enabled = true) {
  return useQuery({
    queryKey: mergeKeys.global(),
    queryFn: async () =>
      json<GlobalMergeState>(await fetch("/api/merge-settings")),
    enabled,
  });
}

export function useUpdateGlobalMergeSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: MergeSettings) =>
      json<GlobalMergeState>(await put("/api/merge-settings", settings)),
    onSuccess: (data) => {
      queryClient.setQueryData(mergeKeys.global(), data);
      // Every project's effective settings may have changed.
      queryClient.invalidateQueries({
        queryKey: [...mergeKeys.all, "project"],
      });
    },
  });
}

export function useProjectMergeSettings(projectId: string, enabled = true) {
  return useQuery({
    queryKey: mergeKeys.project(projectId),
    queryFn: async () =>
      json<ProjectMergeState>(
        await fetch(`/api/projects/${projectId}/merge?allowed=1`)
      ),
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateProjectMergeSettings(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: MergeSettings) =>
      json<ProjectMergeState>(
        await put(`/api/projects/${projectId}/merge`, settings)
      ),
    onSuccess: (data) =>
      // Keep the repository's allowed methods from the last read.
      queryClient.setQueryData<ProjectMergeState>(
        mergeKeys.project(projectId),
        (old) => ({ ...data, allowed: old?.allowed ?? data.allowed })
      ),
  });
}
