import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocSummary, DocView, PublishedDoc } from "@/lib/lumifyhub/types";
import { useProjectsQuery } from "../projects";
import { useWorkspacesQuery } from "../workspaces";
import { lumifyhubKeys, useLumifyHubStatus } from "./index";

export const docKeys = {
  all: [...lumifyhubKeys.all, "docs"] as const,
  list: (workspaceId: string) => [...docKeys.all, "list", workspaceId] as const,
  page: (workspaceId: string, pageId: string) =>
    [...docKeys.all, "page", workspaceId, pageId] as const,
  published: (projectId: string) =>
    [...docKeys.all, "published", projectId] as const,
};

async function call<T>(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

// The linked LumifyHub workspace a project's docs live in, or null.
export function useDocsWorkspace(projectId: string | null | undefined) {
  const { data: status } = useLumifyHubStatus();
  const { data: projects = [] } = useProjectsQuery();
  const { data: workspaces = [] } = useWorkspacesQuery();
  if (!status?.connected || !projectId) return null;
  const project = projects.find((p) => p.id === projectId);
  const workspace = workspaces.find((w) => w.id === project?.workspace_id);
  return workspace?.lh_workspace_slug ? workspace : null;
}

export function useDocs(workspaceId: string | null) {
  return useQuery({
    queryKey: docKeys.list(workspaceId ?? ""),
    queryFn: async () =>
      (
        await call<{ pages: DocSummary[] }>(
          `/api/workspaces/${workspaceId}/lumifyhub/pages`
        )
      ).pages,
    enabled: !!workspaceId,
    staleTime: 30000,
  });
}

export function useDoc(workspaceId: string | null, pageId: string | null) {
  return useQuery({
    queryKey: docKeys.page(workspaceId ?? "", pageId ?? ""),
    queryFn: async () =>
      (
        await call<{ page: DocView }>(
          `/api/workspaces/${workspaceId}/lumifyhub/pages/${pageId}`
        )
      ).page,
    enabled: !!workspaceId && !!pageId,
  });
}

export function usePublishedDocs(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: docKeys.published(projectId ?? ""),
    queryFn: async () =>
      (
        await call<{ docs: PublishedDoc[] }>(
          `/api/projects/${projectId}/lumifyhub/docs`
        )
      ).docs,
    enabled: !!projectId && enabled,
  });
}

export function usePublishDoc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, path }: { projectId: string; path: string }) =>
      call<{ doc: PublishedDoc }>(`/api/projects/${projectId}/lumifyhub/docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }).then((r) => r.doc),
    onSettled: () => queryClient.invalidateQueries({ queryKey: docKeys.all }),
  });
}
