import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DoneOutcome } from "@/lib/done";
import type { BulkResult, PreviewRow } from "@/lib/done/bulk";
import type { ArchivedView } from "@/lib/done/archive";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "../tasks";

export const archivedKeys = {
  all: ["archived-sessions"] as const,
  list: (workspaceId?: string) =>
    [...archivedKeys.all, workspaceId ?? "all"] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const post = (url: string, body?: object) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

function useDoneMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      for (const queryKey of [sessionKeys.all, taskKeys.all, archivedKeys.all])
        queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useDoneSession() {
  return useDoneMutation(
    async (id: string) =>
      (
        await json<{ outcome: DoneOutcome }>(
          await post(`/api/sessions/${id}/done`)
        )
      ).outcome
  );
}

export function useDoneIdle() {
  return useDoneMutation(async (workspaceId: string) =>
    json<BulkResult>(await post("/api/sessions/done-idle", { workspaceId }))
  );
}

export function useUnarchiveSession() {
  return useDoneMutation(async (id: string) =>
    json(await post(`/api/sessions/${id}/unarchive`))
  );
}

export function useArchivedQuery(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: archivedKeys.list(workspaceId),
    queryFn: async () =>
      (
        await json<{ sessions: ArchivedView[] }>(
          await fetch(
            `/api/sessions/archived${workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : ""}`
          )
        )
      ).sessions,
    enabled,
  });
}

export function useCleanupPreview(workspaceId: string | null) {
  return useQuery({
    queryKey: [...archivedKeys.all, "preview", workspaceId] as const,
    queryFn: async () =>
      (
        await json<{ rows: PreviewRow[] }>(
          await fetch(
            `/api/sessions/done-idle?workspaceId=${encodeURIComponent(workspaceId!)}`
          )
        )
      ).rows,
    enabled: !!workspaceId,
    staleTime: 0,
  });
}
