import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChildView, GroupView } from "@/lib/fork/types";

export type { ChildView, GroupView };

export interface ForkChildrenView {
  enabled: boolean;
  // Set when this session is itself a fork child.
  asChild: {
    parentId: string;
    parentName: string;
    n: number;
    label: string;
    state: ChildView["state"];
    worktree: boolean;
  } | null;
  children: ChildView[];
  groups: GroupView[];
}

export const forkKeys = {
  all: ["forks"] as const,
  children: (sessionId: string) => ["forks", "children", sessionId] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// A session's forks. Only asked while the experiment is on; refetched
// every few seconds while any is still going (results land by themselves).
export function useForkChildren(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: forkKeys.children(sessionId),
    queryFn: async () =>
      json<ForkChildrenView>(
        await fetch(
          `/api/fork/children?session=${encodeURIComponent(sessionId)}`
        )
      ),
    enabled,
    staleTime: 2_000,
    refetchInterval: (q) =>
      q.state.data?.children.some((c) => c.state !== "settled") ||
      q.state.data?.asChild
        ? 4_000
        : false,
  });
}

export function useStartForks(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { instructions: string[]; worktree: boolean }) =>
      json<{ children: { id: string; n: number; label: string }[] }>(
        await fetch("/api/fork", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sessionId, ...input }),
        })
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: forkKeys.children(sessionId) }),
  });
}

export function useCancelForks(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ref?: string; all?: boolean }) =>
      json<{ cancelled: string[] }>(
        await fetch("/api/fork/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: sessionId, ...input }),
        })
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: forkKeys.children(sessionId) }),
  });
}
