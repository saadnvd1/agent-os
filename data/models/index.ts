import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EffectiveModels,
  ModelSettings,
  WorkspaceModels,
} from "@/lib/models/config";
import type { ModelRole } from "@/lib/models/roles";
import type { ProviderTest } from "@/lib/models/test-provider";
import type { ResumeResult } from "@/lib/models/resume";
import type { ModelOverride } from "@/lib/models/resolve";
import type { Comparison } from "@/lib/usage/compare";
import type { ModelChoice } from "@/lib/models/catalog";
import type { RoleMap } from "@/lib/models/config";
import type { RoleScope, agentRolesView } from "@/lib/models/agent-roles-view";

// Model routing (lib/models): role models, providers, prices.
export const modelKeys = {
  all: ["models"] as const,
  workspace: (id: string) => [...modelKeys.all, "workspace", id] as const,
  compare: (days: number) => [...modelKeys.all, "compare", days] as const,
};

export const agentRoleKeys = {
  roles: (scope: RoleScope, id?: string | null) =>
    [...modelKeys.all, "agent-roles", scope, id ?? null] as const,
  choices: [...modelKeys.all, "choices"] as const,
  crew: (sessionId: string) => ["sessions", sessionId, "crew"] as const,
};

export type AgentRolesResponse = ReturnType<typeof agentRolesView>;

export interface CrewResponse {
  agentRole: string | null;
  crewId: string | null;
  members: {
    id: string;
    name: string;
    agentRole: string | null;
    model: string | null;
    ref: string | null;
    locality: "local" | "cloud";
    availability: "up" | "down" | "unknown";
  }[];
}

export interface ModelsResponse {
  saved: ModelSettings;
  effective: EffectiveModels;
  defaults: Record<ModelRole, string>;
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const send = (url: string, method: string, body: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function useModelsQuery(enabled = true) {
  return useQuery({
    queryKey: modelKeys.all,
    queryFn: async () => json<ModelsResponse>(await fetch("/api/models")),
    staleTime: 60_000,
    enabled,
  });
}

export function useUpdateModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: ModelSettings) =>
      json<ModelsResponse>(await send("/api/models", "PUT", settings)),
    onSuccess: (data) => queryClient.setQueryData(modelKeys.all, data),
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: async (input: { provider: string; model?: string }) =>
      json<ProviderTest>(await send("/api/models/test", "POST", input)),
  });
}

export function useWorkspaceModelsQuery(workspaceId: string) {
  return useQuery({
    queryKey: modelKeys.workspace(workspaceId),
    queryFn: async () =>
      json<WorkspaceModels>(
        await fetch(`/api/workspaces/${workspaceId}/models`)
      ),
    staleTime: 60_000,
  });
}

export function useUpdateWorkspaceModels(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (models: WorkspaceModels) =>
      json<WorkspaceModels>(
        await send(`/api/workspaces/${workspaceId}/models`, "PUT", models)
      ),
    onSuccess: (data) =>
      queryClient.setQueryData(modelKeys.workspace(workspaceId), data),
  });
}

export function useResumeOnModel() {
  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      model: ModelOverride;
      message?: string;
    }) =>
      json<ResumeResult>(
        await send(`/api/tasks/${input.taskId}/model`, "POST", {
          model: input.model,
          message: input.message,
        })
      ),
  });
}

export function useCompareQuery(days: number, enabled = true) {
  return useQuery({
    queryKey: modelKeys.compare(days),
    queryFn: async () =>
      json<Comparison>(await fetch(`/api/usage/compare?days=${days}`)),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

// Every model a role can be set to: each usable provider's, as references.
export { modelChoices } from "@/lib/models/choices";

// The agent roles (Developer, Analyst, Reviewer, Supervisor) at a scope:
// Settings, a workspace or a project.
export function useAgentRolesQuery(scope: RoleScope, id?: string | null) {
  return useQuery({
    queryKey: agentRoleKeys.roles(scope, id),
    queryFn: async () =>
      json<AgentRolesResponse>(
        await fetch(
          `/api/agent-roles?scope=${scope}${id ? `&id=${encodeURIComponent(id)}` : ""}`
        )
      ),
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: scope === "settings" || !!id,
  });
}

export function useSaveAgentRoles(scope: RoleScope, id?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { roles: RoleMap; fallbacks?: RoleMap }) =>
      json<AgentRolesResponse>(
        await send("/api/agent-roles", "PUT", { scope, id, ...input })
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: modelKeys.all });
      queryClient.setQueryData(agentRoleKeys.roles(scope, id), data);
    },
  });
}

// Every model a picker offers, with locality and availability.
export function useModelChoices(enabled = true) {
  return useQuery({
    queryKey: agentRoleKeys.choices,
    queryFn: async () =>
      (
        await json<{ choices: ModelChoice[] }>(
          await fetch("/api/models/choices")
        )
      ).choices,
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled,
  });
}

export function useCrewQuery(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: agentRoleKeys.crew(sessionId ?? ""),
    queryFn: async () =>
      json<CrewResponse>(await fetch(`/api/sessions/${sessionId}/crew`)),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: !!sessionId && enabled,
  });
}

export function useSwitchSessionModel(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ref: string) =>
      json<{ ok: true }>(
        await send(`/api/sessions/${sessionId}/model`, "POST", { ref })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: modelKeys.all });
    },
  });
}
