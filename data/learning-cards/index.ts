import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Card } from "@/lib/learning-cards/types";
import { useExperiment } from "../experiments";

export type { Card };

export interface CardEdits {
  lesson?: string;
  brief?: string;
  taskPrompt?: string;
}

export const learningCardsKeys = {
  session: (sessionId: string) => ["learning-cards", sessionId] as const,
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
    refetchInterval: 30_000,
  });
}

function useDecide(sessionId: string) {
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
      queryClient.invalidateQueries({
        queryKey: learningCardsKeys.session(sessionId),
      });
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

export const useApplyCard = (sessionId: string) => {
  const m = useDecide(sessionId);
  return {
    ...m,
    apply: (id: number, edits: CardEdits = {}) =>
      m.mutate({ id, action: "apply", ...edits }),
    dismiss: (id: number) => m.mutate({ id, action: "dismiss" }),
  };
};
