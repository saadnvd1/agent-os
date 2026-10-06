import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrchestratorOverview } from "@/lib/orchestrator/overview";
import { statusKeys } from "../sessions/keys";

export const orchestratorKeys = {
  all: ["orchestrators"] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const post = async (url: string, body: object) =>
  json(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

// Every workspace's orchestrator: open asks, paused, tasks in review.
export function useOrchestratorsQuery() {
  return useQuery({
    queryKey: orchestratorKeys.all,
    queryFn: async () =>
      (
        await json<{ workspaces: OrchestratorOverview[] }>(
          await fetch("/api/orchestrators")
        )
      ).workspaces,
    staleTime: 3000,
    refetchInterval: 5000,
  });
}

export function useOrchestratorOverview(workspaceId: string | null) {
  const { data } = useOrchestratorsQuery();
  return data?.find((o) => o.workspaceId === workspaceId) ?? null;
}

export type AskAction =
  | { action: "approve" }
  | { action: "decline" }
  | { action: "reply"; text: string };

export function useAnswerAsk(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ askId, ...answer }: AskAction & { askId: number }) =>
      post(`/api/workspaces/${workspaceId}/orchestrator/asks/${askId}`, answer),
    onMutate: async ({ askId }) => {
      await queryClient.cancelQueries({ queryKey: orchestratorKeys.all });
      queryClient.setQueryData<OrchestratorOverview[]>(
        orchestratorKeys.all,
        (prev) =>
          prev?.map((o) =>
            o.workspaceId === workspaceId
              ? { ...o, asks: o.asks.filter((a) => a.id !== askId) }
              : o
          )
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.all });
      queryClient.invalidateQueries({ queryKey: statusKeys.all });
    },
  });
}

export function usePauseOrchestrator(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paused: boolean) =>
      post(`/api/workspaces/${workspaceId}/orchestrator/pause`, { paused }),
    onMutate: async (paused) => {
      await queryClient.cancelQueries({ queryKey: orchestratorKeys.all });
      queryClient.setQueryData<OrchestratorOverview[]>(
        orchestratorKeys.all,
        (prev) =>
          prev?.map((o) =>
            o.workspaceId === workspaceId ? { ...o, paused } : o
          )
      );
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.all }),
  });
}
