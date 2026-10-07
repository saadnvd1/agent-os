import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@/lib/db/types";
import { api } from "~/lib/api/client";
import { keys } from "~/lib/api/keys";
import { haptic } from "~/lib/haptics";
import type { Machine } from "~/lib/machines/store";

type List = { sessions: Session[] };

// The web's row actions. Pin is optimistic; Done goes through the server's
// own plan (merge through the gates, clean up, archive) and can be refused.
export function useSessionActions(machine: Machine) {
  const qc = useQueryClient();
  const key = keys.sessions(machine.id);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api(machine, `/api/sessions/${id}/pin`, {
        method: "POST",
        body: { pinned },
      }),
    onMutate: async ({ id, pinned }) => {
      haptic.tap();
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<List>(key);
      qc.setQueryData<List>(
        key,
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
    onError: (_e, _v, ctx) => {
      haptic.warn();
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: refresh,
  });

  const done = useMutation({
    mutationFn: (id: string) =>
      api(machine, `/api/sessions/${id}/done`, { method: "POST" }),
    onSuccess: () => haptic.success(),
    onError: () => haptic.warn(),
    onSettled: refresh,
  });

  return { pin, done };
}
