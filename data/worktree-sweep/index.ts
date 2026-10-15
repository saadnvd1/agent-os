import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SweepState } from "@/lib/worktree-sweep/state";

export const sweepKeys = { all: ["worktree-sweep"] as const };

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useWorktreeSweep(enabled = true) {
  return useQuery({
    queryKey: sweepKeys.all,
    queryFn: async () => json<SweepState>(await fetch("/api/worktree-sweep")),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useSetSweepDays() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { days: number | null; projectId?: string }) =>
      json<SweepState>(
        await fetch("/api/worktree-sweep", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        })
      ),
    onSuccess: (data) => queryClient.setQueryData(sweepKeys.all, data),
  });
}

export function useRunSweep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dryRun: boolean) =>
      json<{ started: boolean }>(
        await fetch("/api/worktree-sweep/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun }),
        })
      ),
    onSuccess: () => {
      // The run is in the background; look again as it goes.
      for (const ms of [1500, 8000, 30000])
        setTimeout(
          () => queryClient.invalidateQueries({ queryKey: sweepKeys.all }),
          ms
        );
    },
  });
}
