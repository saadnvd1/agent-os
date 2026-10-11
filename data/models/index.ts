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

// Model routing (lib/models): role models, providers, prices.
export const modelKeys = {
  all: ["models"] as const,
  workspace: (id: string) => [...modelKeys.all, "workspace", id] as const,
  compare: (days: number) => [...modelKeys.all, "compare", days] as const,
};

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
export function modelChoices(effective: EffectiveModels | undefined) {
  return (effective?.providers ?? [])
    .filter((p) => p.enabled)
    .flatMap((p) =>
      p.models.map((m) => ({
        ref: `${p.id}/${m}`,
        label: m,
        provider: p.label,
      }))
    );
}
