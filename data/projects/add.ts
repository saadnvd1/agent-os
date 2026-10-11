import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CloneJob, FolderListing } from "@/lib/project-add";
import { projectKeys } from "./keys";

export interface ExistingProject {
  id: string;
  name: string;
  workspaceId: string | null;
}

// A folder that's already a project: the add form offers to move it.
export class ProjectExistsError extends Error {
  constructor(
    message: string,
    readonly existing: ExistingProject
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (res.status === 409 && data.existing)
    throw new ProjectExistsError(data.error, data.existing);
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

// A project from a folder ({ path }) or a new one from a name, in a
// workspace when given. moveExisting moves the project already at { path }.
export function useInitProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { hostId: string; workspaceId: string | null } & (
        | { path: string; moveExisting?: boolean }
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
      workspaceId: string | null;
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
