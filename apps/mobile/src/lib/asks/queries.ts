import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrchestratorOverview } from "@/lib/orchestrator/ask-view";
import { api } from "~/lib/api/client";
import { keys } from "~/lib/api/keys";
import type { Machine } from "~/lib/machines/store";

export function useOrchestrators(machine: Machine | null) {
  return useQuery({
    queryKey: keys.asks(machine?.id ?? "none"),
    queryFn: () =>
      api<{ workspaces: OrchestratorOverview[] }>(
        machine!,
        "/api/orchestrators"
      ),
    select: (d) => d.workspaces,
    enabled: !!machine,
    refetchInterval: 5000,
  });
}

export type AskAnswer =
  { action: "reply"; text: string } | { action: "decline" };

export function useAnswerAsk(machine: Machine | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      workspaceId: string;
      askId: number;
      answer: AskAnswer;
    }) =>
      api(
        machine!,
        `/api/workspaces/${encodeURIComponent(v.workspaceId)}/orchestrator/asks/${v.askId}`,
        { method: "POST", body: v.answer }
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: keys.asks(machine?.id ?? "none") }),
  });
}
