import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionKeys } from "../sessions/keys";

export function useToggleGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      path,
      expanded,
    }: {
      path: string;
      expanded: boolean;
    }) => {
      const res = await fetch(`/api/groups/${encodeURIComponent(path)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expanded }),
      });
      if (!res.ok) throw new Error("Failed to toggle group");
      return res.json();
    },
    onMutate: async ({ path, expanded }) => {
      await queryClient.cancelQueries({ queryKey: sessionKeys.list() });
      const previous = queryClient.getQueryData(sessionKeys.list());
      queryClient.setQueryData(
        sessionKeys.list(),
        (
          old:
            | {
                sessions: unknown[];
                groups: Array<{ path: string; expanded: boolean }>;
              }
            | undefined
        ) =>
          old
            ? {
                ...old,
                groups: old.groups.map((g) =>
                  g.path === path ? { ...g, expanded } : g
                ),
              }
            : old
      );
      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionKeys.list(), context.previous);
      }
    },
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      parentPath,
    }: {
      name: string;
      parentPath?: string;
    }) => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentPath }),
      });
      if (!res.ok) throw new Error("Failed to create group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(`/api/groups/${encodeURIComponent(path)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete group");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}
