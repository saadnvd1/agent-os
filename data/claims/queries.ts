import { useMutation, useQuery } from "@tanstack/react-query";
import type { ClaimsView } from "@/lib/claims/view";
import type { StartWarning } from "@/lib/claims/startWarning";
import { usePollWhenOffline } from "../push/connection";
import { claimKeys } from "./keys";

// Claims here and on linked machines. Pushed when a claim changes; it polls
// only while the stream is down.
export function useClaims(opts: { project?: string; enabled?: boolean } = {}) {
  const { project, enabled = true } = opts;
  return useQuery({
    queryKey: claimKeys.list(project),
    queryFn: async (): Promise<ClaimsView> => {
      const res = await fetch(
        `/api/claims${project ? `?project=${encodeURIComponent(project)}` : ""}`
      );
      if (!res.ok) throw new Error("Failed to load claims");
      return res.json();
    },
    enabled,
    staleTime: 5000,
    refetchInterval: usePollWhenOffline(15000),
  });
}

export interface StartCheckInput {
  projectId: string;
  name?: string;
  prompt: string;
  branch?: string | null;
}

// Who else is on the work a person is about to start. A failure means no
// warning: it never stops a start.
export function useCheckStart() {
  return useMutation({
    mutationFn: async (input: StartCheckInput): Promise<StartWarning[]> => {
      const res = await fetch("/api/claims/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return [];
      return ((await res.json()) as { overlaps: StartWarning[] }).overlaps;
    },
  });
}
