import { useQuery } from "@tanstack/react-query";
import type { LoadView } from "@/lib/load/monitor";

export const loadKeys = { all: ["machine-load"] as const };

// Pushed over /ws/status (data/statuses/stream.ts); never fetched.
export function useMachineLoad(): LoadView | null {
  const { data } = useQuery<LoadView | null>({
    queryKey: loadKeys.all,
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? null;
}

// One session's share, re-rendering only when it changes.
export function useSessionUsage(sessionId: string) {
  const { data } = useQuery({
    queryKey: loadKeys.all,
    queryFn: () => null as LoadView | null,
    enabled: false,
    staleTime: Infinity,
    select: (load: LoadView | null) => load?.sessions[sessionId] ?? null,
  });
  return data ?? null;
}

const gb = (bytes: number) => {
  const n = bytes / 2 ** 30;
  return n >= 10 ? `${Math.round(n)} GB` : `${n.toFixed(1)} GB`;
};

// "3.1 cores · 4.2 GB"
export function usageLabel(u: { cores: number; rssBytes: number }): string {
  return `${u.cores.toFixed(1)} cores · ${gb(u.rssBytes)}`;
}
