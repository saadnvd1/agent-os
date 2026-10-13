import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeatureView } from "@/lib/plans/view";
import { usePollWhenOffline } from "../push/connection";

export const featureKeys = {
  all: ["features"] as const,
  list: (workspaceId: string | null) =>
    [...featureKeys.all, "list", workspaceId ?? "all"] as const,
};

export function useFeaturesQuery(workspaceId: string | null = null) {
  return useQuery({
    queryKey: featureKeys.list(workspaceId),
    queryFn: async () => {
      const res = await fetch(
        `/api/features${workspaceId ? `?workspace=${workspaceId}` : ""}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data.features as FeatureView[];
    },
    // Pushed when features or their pieces change.
    refetchInterval: usePollWhenOffline(20000),
  });
}

export function useReleasePiece() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/features/pieces/${id}/release`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: featureKeys.all }),
  });
}
