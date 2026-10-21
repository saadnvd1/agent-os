import { useQuery } from "@tanstack/react-query";
import type { LoopSummary, LoopView } from "@/lib/loops/types";
import { usePollWhenOffline } from "../push/connection";
import { loopKeys } from "./keys";

const base = (taskId: string) =>
  `/api/tasks/${encodeURIComponent(taskId)}/loop`;

// The task's loop, or null when it has none. Pushed when the loop's tables
// change; it polls only while the stream is down.
export function useTaskLoop(taskId: string | undefined, enabled = true) {
  const poll = usePollWhenOffline(10000);
  return useQuery({
    queryKey: loopKeys.ofTask(taskId ?? ""),
    queryFn: async (): Promise<LoopView | null> => {
      const res = await fetch(base(taskId!));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't load the loop");
      return body.view ?? null;
    },
    enabled: !!taskId && enabled,
    staleTime: 3000,
    refetchInterval: poll,
  });
}

// The pill of every task that has had a loop lately.
export function useLoopSummaries() {
  const poll = usePollWhenOffline(15000);
  return useQuery({
    queryKey: [...loopKeys.all, "summaries"] as const,
    queryFn: async (): Promise<Record<string, LoopSummary | null>> => {
      const res = await fetch("/api/loops");
      const body = await res.json().catch(() => ({}));
      return res.ok ? (body.loops ?? {}) : {};
    },
    staleTime: 5000,
    refetchInterval: poll,
  });
}
