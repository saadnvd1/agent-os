import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AskView,
  OrchestratorOverview,
} from "@/lib/orchestrator/overview";
import { provePresence } from "../presence";
import { statusKeys } from "../sessions/keys";
import { usePollWhenOffline } from "../push/connection";

export const orchestratorKeys = {
  all: ["orchestrators"] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// A request that never got an answer (AgentOS restarting, offline) says so,
// rather than the browser's bare "Failed to fetch".
const post = async (url: string, body: object) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new Error(
      "Couldn't reach AgentOS, so your answer may not be recorded. Try again."
    );
  });
  return json(res);
};

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
    // Pushed when asks, workspaces or sessions change; stale asks are
    // settled by the orchestrator's watcher.
    refetchInterval: usePollWhenOffline(5000),
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

// Approve names what it approves (the commit or brake the card showed) and,
// for anything but a plain decision, carries a passkey assertion for it.
export function useAnswerAsk(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ask,
      ...answer
    }: AskAction & {
      ask: Pick<AskView, "id" | "binding" | "presence" | "subject">;
    }) => {
      const url = `/api/workspaces/${workspaceId}/orchestrator/asks/${ask.id}`;
      const revokes =
        answer.action === "decline" && ask.subject.startsWith("passkey:");
      if (answer.action !== "approve" && !revokes) return post(url, answer);
      const assertion = ask.presence
        ? await provePresence({
            purpose: "approve",
            workspaceId,
            askId: ask.id,
            binding: ask.binding,
          })
        : undefined;
      return post(url, { ...answer, binding: ask.binding, assertion });
    },
    // The card leaves at once, and comes back if the answer wasn't recorded.
    onMutate: async ({ ask: { id: askId } }) => {
      await queryClient.cancelQueries({ queryKey: orchestratorKeys.all });
      const previous = queryClient.getQueryData<OrchestratorOverview[]>(
        orchestratorKeys.all
      );
      queryClient.setQueryData<OrchestratorOverview[]>(
        orchestratorKeys.all,
        (prev) =>
          prev?.map((o) =>
            o.workspaceId === workspaceId
              ? { ...o, asks: o.asks.filter((a) => a.id !== askId) }
              : o
          )
      );
      return { previous };
    },
    onError: (_error, _answer, context) => {
      if (context?.previous)
        queryClient.setQueryData(orchestratorKeys.all, context.previous);
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
    // Resuming lets it act again, so it needs a passkey.
    mutationFn: async (paused: boolean) =>
      post(`/api/workspaces/${workspaceId}/orchestrator/pause`, {
        paused,
        assertion: paused
          ? undefined
          : await provePresence({ purpose: "resume", workspaceId }),
      }),
    onSuccess: (_data, paused) => {
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
