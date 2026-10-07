import { useQuery } from "@tanstack/react-query";
import type { AgentProbe } from "@/lib/agents/probe";

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
