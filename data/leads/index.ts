import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DirectionAction,
  LeadDirectionView,
} from "@/lib/leads/direction-view";
import type { LeadThreadView } from "@/lib/leads/thread-view";

export const leadKeys = {
  direction: (sessionId: string) => ["leads", "direction", sessionId] as const,
  thread: (q: object, all: boolean) => ["leads", "thread", q, all] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// A lead chat's direction (null for any other chat).
export function useLeadDirection(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: leadKeys.direction(sessionId),
    queryFn: async () =>
      (
        await json<{ direction: LeadDirectionView | null }>(
          await fetch(
            `/api/leads/direction?sessionId=${encodeURIComponent(sessionId)}`
          )
        )
      ).direction,
    enabled,
    staleTime: 30000,
  });
}

// Pin one of the owner's messages, take a pin down, or answer a proposal.
export function useDirectionAction(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: DirectionAction) =>
      (
        await json<{ direction: LeadDirectionView | null }>(
          await post("/api/leads/direction", { sessionId, ...action })
        )
      ).direction,
    onSuccess: (direction) =>
      qc.setQueryData(leadKeys.direction(sessionId), direction),
  });
}

// The one tap on a lead's proposed pins: the ones kept are pinned, the rest
// dropped, and an adopted lead switches over to a fresh start.
export function useConfirmPins(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      workspaceId: string;
      kind: string;
      confirm: number[];
      switchOver: boolean;
    }) => json<unknown>(await post("/api/leads/proposals", input)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: leadKeys.direction(sessionId) }),
  });
}

// A thread between two leads, up to the message a card stands for (all of
// it once opened). Mail arrives with turns, so it's read again when stale.
export function useLeadThread(
  q: {
    workspaceId: string;
    thread: string;
    a: string;
    b: string;
    upTo?: number;
  },
  all: boolean
) {
  return useQuery({
    queryKey: leadKeys.thread(q, all),
    queryFn: async () => {
      const params = new URLSearchParams({
        workspaceId: q.workspaceId,
        thread: q.thread,
        a: q.a,
        b: q.b,
        ...(q.upTo ? { upTo: String(q.upTo) } : {}),
        ...(all ? { all: "1" } : {}),
      });
      return (
        await json<{ thread: LeadThreadView | null }>(
          await fetch(`/api/leads/threads?${params}`)
        )
      ).thread;
    },
    staleTime: 30000,
  });
}
