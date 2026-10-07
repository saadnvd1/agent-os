import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CloneJob, FolderListing } from "@/lib/project-add";
import { projectKeys } from "./keys";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useFolderListing(hostId: string, path: string) {
  return useQuery({
    queryKey: [...projectKeys.all, "browse", hostId, path],
    queryFn: async () =>
      json<FolderListing>(
        await fetch(
          `/api/projects/browse?${new URLSearchParams({ hostId, path })}`
        )
      ),
    staleTime: 10_000,
  });
}

// A project from a folder ({ path }) or a new one from a name.
export function useInitProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { hostId: string } & (
        | { path: string }
        | { parent: string; name: string }
      )
    ) =>
      (
        await json<{ project: { id: string; name: string } }>(
          await post("/api/projects/init", input)
        )
      ).project,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
  });
}

export function useStartClone() {
  return useMutation({
    mutationFn: async (input: {
      hostId: string;
      parent: string;
      url: string;
    }) =>
      (await json<{ job: CloneJob }>(await post("/api/projects/clone", input)))
        .job,
  });
}

export function useCloneJob(jobId: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: [...projectKeys.all, "clone", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      const { job } = await json<{ job: CloneJob }>(
        await fetch(`/api/projects/clone/${jobId}`)
      );
      if (job.status === "done")
        void queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      return job;
    },
    refetchInterval: (q) =>
      q.state.data?.status === "running" || !q.state.data ? 700 : false,
  });
}

export function usePublishPrivate() {
  return useMutation({
    mutationFn: async (projectId: string) =>
      (
        await json<{ url: string }>(
          await post(`/api/projects/${projectId}/github`, {})
        )
      ).url,
  });
}
