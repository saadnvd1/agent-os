import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SessionGroup } from "@/lib/sidebar/shelves";
import { sessionKeys } from "@/data/sessions/keys";
import type { SessionsResponse } from "@/data/sessions/queries";

async function send<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not change the group");
  return data as T;
}

// Groups ride along in the sessions response, so every edit patches that
// one cache entry and lets the change push settle the rest.
function useGroupCache() {
  const queryClient = useQueryClient();
  const key = sessionKeys.list();
  return {
    key,
    refresh: () => queryClient.invalidateQueries({ queryKey: key }),
    async patch(edit: (old: SessionsResponse) => SessionsResponse) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SessionsResponse>(key);
      queryClient.setQueryData<SessionsResponse>(
        key,
        (old) => old && edit(old)
      );
      return { previous };
    },
    restore(previous?: SessionsResponse) {
      if (previous) queryClient.setQueryData(key, previous);
    },
  };
}

export function useCreateGroup() {
  const cache = useGroupCache();
  return useMutation({
    mutationFn: (v: { name: string; workspaceId: string | null }) =>
      send<{ sessionGroup: SessionGroup }>("/api/session-groups", "POST", v),
    onSuccess: ({ sessionGroup }) =>
      cache.patch((old) => ({
        ...old,
        sessionGroups: [...old.sessionGroups, sessionGroup],
      })),
    onError: (e: Error) => toast.error(e.message),
    onSettled: cache.refresh,
  });
}

export function useUpdateGroup() {
  const cache = useGroupCache();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      collapsed?: boolean;
    }) => send(`/api/session-groups/${id}`, "PATCH", patch),
    onMutate: ({ id, ...patch }) =>
      cache.patch((old) => ({
        ...old,
        sessionGroups: old.sessionGroups.map((g) =>
          g.id === id ? { ...g, ...patch } : g
        ),
      })),
    onError: (e: Error, _v, ctx) => {
      cache.restore(ctx?.previous);
      toast.error(e.message);
    },
    onSettled: cache.refresh,
  });
}

export function useReorderGroups() {
  const cache = useGroupCache();
  return useMutation({
    mutationFn: (v: { workspaceId: string | null; ids: string[] }) =>
      send("/api/session-groups/order", "POST", v),
    onMutate: ({ ids }) =>
      cache.patch((old) => ({
        ...old,
        sessionGroups: old.sessionGroups.map((g) =>
          ids.includes(g.id) ? { ...g, sort_order: ids.indexOf(g.id) } : g
        ),
      })),
    onError: (e: Error, _v, ctx) => {
      cache.restore(ctx?.previous);
      toast.error(e.message);
    },
    onSettled: cache.refresh,
  });
}

// Deleting is soft: the toast's Undo restores the group and its members.
export function useDeleteGroup() {
  const cache = useGroupCache();
  return useMutation({
    mutationFn: (g: { id: string; name: string }) =>
      send(`/api/session-groups/${g.id}`, "DELETE"),
    onMutate: (g) =>
      cache.patch((old) => ({
        ...old,
        sessionGroups: old.sessionGroups.filter((x) => x.id !== g.id),
      })),
    onSuccess: (_d, g) =>
      toast(`Deleted group ${g.name}`, {
        description: "Its sessions went back to the shelves.",
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () =>
            send(`/api/session-groups/${g.id}/restore`, "POST")
              .catch((e: Error) => toast.error(e.message))
              .finally(cache.refresh),
        },
      }),
    onError: (e: Error, _v, ctx) => {
      cache.restore(ctx?.previous);
      toast.error(e.message);
    },
    onSettled: cache.refresh,
  });
}

// One or many sessions into a group, or out of it with groupId null.
export function useAssignGroup() {
  const cache = useGroupCache();
  return useMutation({
    mutationFn: (v: { ids: string[]; groupId: string | null }) =>
      send("/api/sessions/group", "POST", v),
    onMutate: ({ ids, groupId }) =>
      cache.patch((old) => ({
        ...old,
        sessions: old.sessions.map((s) =>
          ids.includes(s.id) ? { ...s, session_group_id: groupId } : s
        ),
      })),
    onError: (e: Error, _v, ctx) => {
      cache.restore(ctx?.previous);
      toast.error(e.message);
    },
    onSettled: cache.refresh,
  });
}
