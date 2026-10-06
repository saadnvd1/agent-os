import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, Workspace } from "@/lib/db";
import type {
  BoardTodo,
  LhBoard,
  LhWorkspace,
  LumifyHubStatus,
} from "@/lib/lumifyhub/types";
import { workspaceKeys } from "../workspaces";
import { projectKeys } from "../projects/keys";
import { taskKeys } from "../tasks";

export const lumifyhubKeys = {
  all: ["lumifyhub"] as const,
  status: () => [...lumifyhubKeys.all, "status"] as const,
  workspaces: () => [...lumifyhubKeys.all, "workspaces"] as const,
  boards: (workspaceId: string) =>
    [...lumifyhubKeys.all, "boards", workspaceId] as const,
  todos: () => [...lumifyhubKeys.all, "todos"] as const,
};

async function call<T>(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

export function useLumifyHubStatus() {
  return useQuery({
    queryKey: lumifyhubKeys.status(),
    queryFn: () => call<LumifyHubStatus>("/api/lumifyhub"),
    staleTime: 60000,
  });
}

function useInvalidating<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: lumifyhubKeys.all });
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

// Sends this tab to LumifyHub's approve page; it comes back to the callback.
export function useStartConnect() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await call<{ url: string }>(
        "/api/lumifyhub/connect",
        "POST"
      );
      window.location.assign(url);
    },
  });
}

export function useConnectWithToken() {
  return useInvalidating((token: string) =>
    call<LumifyHubStatus>("/api/lumifyhub/token", "POST", { token })
  );
}

export function useDisconnect() {
  return useInvalidating(() =>
    call<LumifyHubStatus>("/api/lumifyhub", "DELETE")
  );
}

export function useLhWorkspaces(enabled: boolean) {
  return useQuery({
    queryKey: lumifyhubKeys.workspaces(),
    queryFn: async () =>
      (await call<{ workspaces: LhWorkspace[] }>("/api/lumifyhub/workspaces"))
        .workspaces,
    enabled,
  });
}

export type WorkspaceLinkTarget =
  | { lhWorkspaceId: string }
  | { create: true; name?: string };

export function useLinkWorkspace() {
  return useInvalidating(
    ({ id, target }: { id: string; target: WorkspaceLinkTarget }) =>
      call<{ workspace: Workspace }>(
        `/api/workspaces/${id}/lumifyhub`,
        "PUT",
        target
      )
  );
}

export function useUnlinkWorkspace() {
  return useInvalidating((id: string) =>
    call(`/api/workspaces/${id}/lumifyhub`, "DELETE")
  );
}

export function useWorkspaceBoards(workspaceId: string | null) {
  return useQuery({
    queryKey: lumifyhubKeys.boards(workspaceId ?? ""),
    queryFn: async () =>
      (
        await call<{ boards: LhBoard[] }>(
          `/api/workspaces/${workspaceId}/lumifyhub/boards`
        )
      ).boards,
    enabled: !!workspaceId,
  });
}

export type BoardLinkTarget =
  | { boardId: string }
  | { create: true; title?: string };

export function useLinkBoard() {
  return useInvalidating(
    ({ projectId, target }: { projectId: string; target: BoardLinkTarget }) =>
      call<{ project: Project }>(
        `/api/projects/${projectId}/lumifyhub`,
        "PUT",
        target
      )
  );
}

export function useUnlinkBoard() {
  return useInvalidating((projectId: string) =>
    call(`/api/projects/${projectId}/lumifyhub`, "DELETE")
  );
}

export function useBoardTodos(enabled: boolean) {
  return useQuery({
    queryKey: lumifyhubKeys.todos(),
    queryFn: async () =>
      (await call<{ boards: BoardTodo[] }>("/api/lumifyhub/cards")).boards,
    enabled,
    refetchInterval: enabled ? 30000 : false,
  });
}

export function useRunCard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      cardId,
    }: {
      projectId: string;
      cardId: string;
    }) => call(`/api/lumifyhub/cards/${cardId}/run`, "POST", { projectId }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: lumifyhubKeys.todos() });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
