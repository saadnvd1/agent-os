import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DirectionAction,
  LeadDirectionView,
} from "@/lib/leads/direction-view";
import type { LeadThreadView } from "@/lib/leads/thread-view";
import type { ChiefView } from "@/lib/leads/chief";
import type { LeadSetupView } from "@/lib/leads/setup";
import { orchestratorKeys } from "@/data/orchestrators";
import { sessionKeys } from "@/data/sessions/keys";

export const leadKeys = {
  direction: (sessionId: string) => ["leads", "direction", sessionId] as const,
  chief: (sessionId: string) => ["leads", "chief", sessionId] as const,
  thread: (q: object, all: boolean) => ["leads", "thread", q, all] as const,
  setup: (workspaceId: string) => ["leads", "setup", workspaceId] as const,
  charter: (workspaceId: string, kind: string) =>
    ["leads", "charter", workspaceId, kind] as const,
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

// A chief of staff's chat header (null for any other chat).
export function useChiefView(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: leadKeys.chief(sessionId),
    queryFn: async () =>
      (
        await json<{ chief: ChiefView | null }>(
          await fetch(
            `/api/leads/chief?sessionId=${encodeURIComponent(sessionId)}`
          )
        )
      ).chief,
    enabled,
    staleTime: 60000,
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

// What "Add leads" offers for a workspace: its kinds, and chats to adopt.
export function useLeadSetup(workspaceId: string | null) {
  return useQuery({
    queryKey: leadKeys.setup(workspaceId ?? ""),
    queryFn: async () =>
      (
        await json<{ setup: LeadSetupView }>(
          await fetch(
            `/api/leads/setup?workspaceId=${encodeURIComponent(workspaceId!)}`
          )
        )
      ).setup,
    enabled: !!workspaceId,
  });
}

// "Add leads" with what was picked: new leads first (which also makes the
// chief and the Tech lead), then each chat adopted in turn. A failed
// adoption doesn't undo the rest; its reason comes back.
export function useAddLeads(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kinds: string[];
      adopt: { sessionId: string; kind: string }[];
    }) => {
      await json(await post("/api/leads", { workspaceId, kinds: input.kinds }));
      const failed: string[] = [];
      for (const a of input.adopt) {
        const res = await post("/api/leads/adopt", { workspaceId, ...a });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          failed.push(body.error || `Couldn't adopt (${res.status})`);
        }
      }
      return { failed };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: orchestratorKeys.all });
      void qc.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export interface CharterFields {
  title: string;
  area: string;
  goal: string;
  charter_md: string;
}

// One lead's charter, read when its editor opens. A chief with none yet has
// no row: the editor starts blank.
export function useLeadCharter(
  workspaceId: string,
  kind: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: leadKeys.charter(workspaceId, kind),
    queryFn: async (): Promise<CharterFields | null> => {
      const res = await fetch(
        `/api/leads/charter?workspaceId=${encodeURIComponent(workspaceId)}&kind=${encodeURIComponent(kind)}`
      );
      if (res.status === 404) return null;
      return (await json<{ charter: CharterFields }>(res)).charter;
    },
    enabled,
  });
}

export function useSaveCharter(workspaceId: string, kind: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fields: CharterFields) => {
      const res = await fetch("/api/leads/charter", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, kind, ...fields }),
      });
      return json<{ charter: CharterFields; delivered: boolean }>(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadKeys.charter(workspaceId, kind) });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}
