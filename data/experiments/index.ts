import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExperimentView } from "@/lib/experiments/view";
import type { UsageDetail } from "@/lib/experiments/meter";
import type { ExperimentId } from "@/lib/experiments/registry";

export type { ExperimentView, UsageDetail };

export interface ExperimentsList {
  locked: boolean;
  experiments: ExperimentView[];
}

export interface ExperimentDetail extends ExperimentView {
  locked: boolean;
  detail: UsageDetail;
}

export const experimentsKeys = {
  all: ["experiments"] as const,
  detail: (id: string) => ["experiments", id] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useExperimentsQuery() {
  return useQuery({
    queryKey: experimentsKeys.all,
    queryFn: async () => json<ExperimentsList>(await fetch("/api/experiments")),
    staleTime: 10_000,
  });
}

export function useExperimentDetailQuery(id: string | null) {
  return useQuery({
    queryKey: experimentsKeys.detail(id ?? ""),
    queryFn: async () =>
      json<ExperimentDetail>(await fetch(`/api/experiments/${id}`)),
    enabled: !!id,
    staleTime: 10_000,
  });
}

// The client's one check: false until the list has loaded.
export function useExperiment(id: ExperimentId): boolean {
  const { data } = useExperimentsQuery();
  return !!data?.experiments.find((e) => e.id === id)?.on;
}

export function useSetExperiment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
      json<ExperimentView>(
        await fetch(`/api/experiments/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on }),
        })
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: experimentsKeys.all }),
  });
}
