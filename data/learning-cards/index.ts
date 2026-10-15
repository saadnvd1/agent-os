import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMemo } from "react";
import type { Card, PendingCardView } from "@/lib/learning-cards/types";
import { useExperiment } from "../experiments";
import { orchestratorKeys } from "../orchestrators";
import { usePollWhenOffline } from "../push/connection";

export type { Card, PendingCardView };

export interface CardEdits {
  lesson?: string;
  brief?: string;
  taskPrompt?: string;
}

export const learningCardsKeys = {
  all: ["learning-cards"] as const,
  pending: ["learning-cards", "pending"] as const,
  session: (sessionId: string) =>
    ["learning-cards", "session", sessionId] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Pending cards of a session; nothing is asked while the experiment is off.
export function useLearningCards(sessionId: string) {
  const enabled = useExperiment("learning-cards");
  return useQuery({
    queryKey: learningCardsKeys.session(sessionId),
    queryFn: async () =>
      (
        await json<{ cards: Card[] }>(
          await fetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/learning-cards`
          )
        )
      ).cards,
    enabled,
    staleTime: 10_000,
    // Pushed when a card is made or decided; this is the offline fallback.
    refetchInterval: usePollWhenOffline(60_000),
  });
}

// Every pending card, for the sidebar's badges. One request for the list.
export function usePendingCards() {
  const enabled = useExperiment("learning-cards");
  return useQuery({
    queryKey: learningCardsKeys.pending,
    queryFn: async () =>
      (
        await json<{ cards: PendingCardView[] }>(
          await fetch("/api/learning-cards")
        )
      ).cards,
    enabled,
    staleTime: 10_000,
    refetchInterval: usePollWhenOffline(60_000),
  });
}

export function usePendingCardSessions(): Map<string, number> {
  const { data } = usePendingCards();
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data ?? [])
      m.set(c.sessionId, (m.get(c.sessionId) ?? 0) + 1);
    return m;
  }, [data]);
}

function useDecide() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      v: { id: number; action: "apply" | "dismiss" } & CardEdits
    ) =>
      json<{ card: Card }>(
        await fetch(`/api/learning-cards/${encodeURIComponent(String(v.id))}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(v),
        })
      ),
    onSuccess: (_d, v) => {
      // The chat's card, the sidebar badge and the Needs-you strip.
      queryClient.invalidateQueries({ queryKey: learningCardsKeys.all });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.all });
      // A saved recipe or a new rule shows up in their own lists.
      if (v.action === "apply") {
        queryClient.invalidateQueries({ queryKey: ["recipes"] });
        queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't do that"),
  });
}

export const useApplyCard = () => {
  const m = useDecide();
  return {
    ...m,
    apply: (id: number, edits: CardEdits = {}) =>
      m.mutate({ id, action: "apply", ...edits }),
    dismiss: (id: number) => m.mutate({ id, action: "dismiss" }),
  };
};
