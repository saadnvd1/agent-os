import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Session, Group } from "@/lib/db";
import { sessionKeys } from "./keys";

interface SessionsResponse {
  sessions: Session[];
  groups: Group[];
}

export function usePinSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const res = await fetch(`/api/sessions/${id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) throw new Error("Failed to pin session");
    },
    onMutate: async ({ id, pinned }) => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.list() });
      const previous = queryClient.getQueryData<SessionsResponse>(
        sessionKeys.list()
      );
      queryClient.setQueryData<SessionsResponse>(
        sessionKeys.list(),
        (old) =>
          old && {
            ...old,
            sessions: old.sessions.map((s) =>
              s.id === id ? { ...s, pinned } : s
            ),
          }
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous)
        queryClient.setQueryData(sessionKeys.list(), context.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() }),
  });
}
