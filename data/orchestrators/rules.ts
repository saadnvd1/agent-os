import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RuleRow } from "@/lib/orchestrator/rules";

// A workspace orchestrator's standing rules (lib/orchestrator/rules).
// Pushed when the table changes (data/push/topics).
export const ruleKeys = {
  all: ["orchestrator-rules"] as const,
  list: (workspaceId: string) => [...ruleKeys.all, workspaceId] as const,
};

const url = (workspaceId: string, ruleId?: number) =>
  `/api/workspaces/${workspaceId}/orchestrator/rules${ruleId ? `/${ruleId}` : ""}`;

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json" },
  }).catch(() => {
    throw new Error("Couldn't reach AgentOS, so this may not be saved.");
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useRulesQuery(workspaceId: string) {
  return useQuery({
    queryKey: ruleKeys.list(workspaceId),
    queryFn: async () =>
      (await call<{ rules: RuleRow[] }>(url(workspaceId))).rules,
    staleTime: 30000,
  });
}

function useRuleMutation<V>(
  workspaceId: string,
  request: (v: V) => Promise<unknown>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ruleKeys.list(workspaceId) }),
  });
}

export const useAddRule = (workspaceId: string) =>
  useRuleMutation(workspaceId, (text: string) =>
    call(url(workspaceId), { method: "POST", body: JSON.stringify({ text }) })
  );

export const useUpdateRule = (workspaceId: string) =>
  useRuleMutation(workspaceId, ({ id, text }: { id: number; text: string }) =>
    call(url(workspaceId, id), {
      method: "PATCH",
      body: JSON.stringify({ text }),
    })
  );

export const useRemoveRule = (workspaceId: string) =>
  useRuleMutation(workspaceId, (id: number) =>
    call(url(workspaceId, id), { method: "DELETE" })
  );
