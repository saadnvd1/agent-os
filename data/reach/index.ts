import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReachReport } from "@/lib/reach/types";

export const reachKeys = {
  all: ["reach"] as const,
};

async function fetchReach(fresh: boolean) {
  const res = await fetch(fresh ? "/api/reach?fresh" : "/api/reach");
  if (!res.ok)
    throw new Error(
      "Couldn't check whether other devices can reach this machine"
    );
  return (await res.json()) as ReachReport;
}

export function useReachQuery(enabled = true) {
  return useQuery({
    queryKey: reachKeys.all,
    queryFn: () => fetchReach(false),
    enabled,
    staleTime: 30_000,
    refetchOnMount: "always",
  });
}

export function useRecheckReach() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => fetchReach(true),
    onSuccess: (report) => client.setQueryData(reachKeys.all, report),
  });
}
