import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentProbe } from "@/lib/agents/probe";
import type { ChatModel } from "@/lib/chat/events";

export const agentKeys = {
  all: ["agents"] as const,
  status: () => [...agentKeys.all, "status"] as const,
};

export function useAgentStatusQuery() {
  return useQuery({
    queryKey: agentKeys.status(),
    queryFn: async () => {
      const res = await fetch("/api/agents/status");
      if (!res.ok) throw new Error("Couldn't check the agents");
      return ((await res.json()) as { agents: Record<string, AgentProbe> })
        .agents;
    },
    // Checked again each time the picker opens.
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

// Asks the server to probe again now, not from its minute-old answer, and
// puts the result where the status query reads it.
export function useRecheckAgents() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/agents/status?fresh");
      if (!res.ok) throw new Error("Couldn't check the agents");
      return ((await res.json()) as { agents: Record<string, AgentProbe> })
        .agents;
    },
    onSuccess: (agents) => client.setQueryData(agentKeys.status(), agents),
  });
}

export const discoveredModelKeys = {
  list: (agent: string, projectId: string | null) =>
    [...agentKeys.all, "models", agent, projectId] as const,
};

// What an agent without a fixed list reports it can run, for a draft's
// picker. Off for agents with a fixed list.
export function useDiscoveredModels(
  agent: string,
  projectId: string | null,
  enabled: boolean
) {
  const client = useQueryClient();
  const key = discoveredModelKeys.list(agent, projectId);
  const fetchModels = async (refresh: boolean) => {
    const params = new URLSearchParams({ agent });
    if (projectId) params.set("projectId", projectId);
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/discovered-models?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't list the models");
    return data.models as ChatModel[];
  };
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchModels(false),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    ...query,
    refresh: async () => client.setQueryData(key, await fetchModels(true)),
  };
}
