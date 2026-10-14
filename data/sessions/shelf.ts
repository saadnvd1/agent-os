import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Session, Group } from "@/lib/db";
import { toSqliteTime } from "@/lib/session-meta";
import { sessionKeys } from "./keys";

interface SessionsResponse {
  sessions: Session[];
  groups: Group[];
}

async function post(url: string, body: object) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => null))?.error ?? "Request failed"
    );
}

// Snooze, wake, mark done and reopen all change a few columns the shelves
// read, so the row moves at once and rolls back if the server refuses.
function useShelfMutation<V extends { id: string }>(
  send: (v: V) => Promise<void>,
  patch: (v: V, now: string) => Partial<Session>
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (v: V) => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.list() });
      const previous = queryClient.getQueryData<SessionsResponse>(
        sessionKeys.list()
      );
      const now = toSqliteTime(new Date());
      queryClient.setQueryData<SessionsResponse>(
        sessionKeys.list(),
        (old) =>
          old && {
            ...old,
            sessions: old.sessions.map((s) =>
              s.id === v.id ? { ...s, ...patch(v, now) } : s
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

// until null wakes it.
export function useSnoozeSession() {
  return useShelfMutation<{ id: string; until: Date | null }>(
    ({ id, until }) =>
      post(`/api/sessions/${id}/snooze`, {
        until: until?.toISOString() ?? null,
      }),
    ({ until }, now) =>
      until
        ? {
            snoozed_until: toSqliteTime(until),
            snoozed_at: now,
            settled_at: null,
          }
        : { snoozed_until: null, snoozed_at: null, active_at: now }
  );
}

export function useSettleSession() {
  return useShelfMutation<{ id: string; settled: boolean }>(
    ({ id, settled }) => post(`/api/sessions/${id}/settle`, { settled }),
    ({ settled }, now) =>
      settled
        ? { settled_at: now, snoozed_until: null, snoozed_at: null }
        : { settled_at: null, active_at: now }
  );
}

async function send(method: string, url: string, body?: object) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => null))?.error ?? "Request failed"
    );
}

// until null: until resumed. The row moves to "pausing" at once; the server
// stops the agent at the end of its step (or now) and the push settles it.
export function usePauseSession() {
  return useShelfMutation<{
    id: string;
    until: Date | null;
    mode: "turn" | "now";
  }>(
    ({ id, until, mode }) =>
      send("POST", `/api/sessions/${id}/pause`, {
        until: until?.toISOString() ?? null,
        mode,
      }),
    ({ until }) => ({
      pause_state: "pausing",
      paused_until: until ? toSqliteTime(until) : null,
    })
  );
}

// Resume now, or keep running while it is still pausing.
export function useResumeSession() {
  return useShelfMutation<{ id: string }>(
    ({ id }) => send("DELETE", `/api/sessions/${id}/pause`),
    () => ({ pause_state: "resuming", paused_until: null })
  );
}

export function useChangeResumeTime() {
  return useShelfMutation<{ id: string; until: Date | null }>(
    ({ id, until }) =>
      send("PATCH", `/api/sessions/${id}/pause`, {
        until: until?.toISOString() ?? null,
      }),
    ({ until }) => ({ paused_until: until ? toSqliteTime(until) : null })
  );
}
