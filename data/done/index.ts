import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DoneOutcome } from "@/lib/done";
import type { BulkResult, PreviewRow } from "@/lib/done/bulk";
import type { ArchivedView } from "@/lib/done/archive";
import type { ResurrectOutcome } from "@/lib/resurrect";
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

// Longer than the server's own deadline for done (lib/done/deadline.ts), so
// the pending toast always ends even if the server never answers.
export const DONE_REQUEST_TIMEOUT_MS = 180_000;

async function post(url: string, body?: object, timeoutMs?: number) {
  const abort = new AbortController();
  const timer = timeoutMs
    ? setTimeout(
        () =>
          abort.abort(
            new Error(
              "The server didn't answer in time. It may still be working: check the row, then try again."
            )
          ),
        timeoutMs
      )
    : undefined;
  try {
    return await fetch(url, {
      signal: abort.signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
}

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
          await post(
            `/api/sessions/${id}/done`,
            undefined,
            DONE_REQUEST_TIMEOUT_MS
          )
        )
      ).outcome
  );
}

// Archiving a session whose forks are still running asks what to do with them.
export class ForkChildrenOpenError extends Error {
  constructor(
    message: string,
    readonly open: number
  ) {
    super(message);
  }
}

export function useArchiveSession() {
  return useDoneMutation(
    async (input: string | { id: string; children: "stop" | "keep" }) => {
      const { id, children } =
        typeof input === "string" ? { id: input, children: undefined } : input;
      const res = await post(
        `/api/sessions/${id}/archive`,
        children ? { children } : undefined
      );
      const data = await res
        .clone()
        .json()
        .catch(() => null);
      if (res.status === 409 && typeof data?.children === "number")
        throw new ForkChildrenOpenError(data.error, data.children);
      return json(res);
    }
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

// Brings a dropped, done or archived session back (lib/resurrect).
export function useResurrectSession() {
  return useDoneMutation(
    async (id: string) =>
      (
        await json<{ outcome: ResurrectOutcome }>(
          await post(
            `/api/sessions/${id}/resurrect`,
            undefined,
            DONE_REQUEST_TIMEOUT_MS
          )
        )
      ).outcome
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
