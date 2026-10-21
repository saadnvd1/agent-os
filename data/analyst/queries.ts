import { useQuery } from "@tanstack/react-query";
import type { AnalystLinkView } from "@/lib/analyst/types";
import { usePollWhenOffline } from "../push/connection";
import { analystKeys } from "./keys";

async function read(url: string): Promise<AnalystLinkView | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Couldn't load the analyst");
  return body.link ?? null;
}

// The pairing a session is in, as coder or analyst, or null. Pushed when a
// pairing or a card changes; it polls only while the stream is down.
export function useSessionAnalyst(sessionId: string | undefined) {
  return useQuery({
    queryKey: analystKeys.ofSession(sessionId ?? ""),
    queryFn: () =>
      read(`/api/sessions/${encodeURIComponent(sessionId!)}/analyst`),
    enabled: !!sessionId,
    staleTime: 5000,
    refetchInterval: usePollWhenOffline(15000),
  });
}

export function useAnalystLink(linkId: string | undefined) {
  return useQuery({
    queryKey: analystKeys.link(linkId ?? ""),
    queryFn: () => read(`/api/analyst/${encodeURIComponent(linkId!)}`),
    enabled: !!linkId,
    staleTime: 5000,
    refetchInterval: usePollWhenOffline(15000),
  });
}
