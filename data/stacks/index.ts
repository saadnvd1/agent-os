import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StackPreview, StackView } from "@/lib/stacks/types";
import { taskKeys } from "../tasks";
import { lumifyhubKeys } from "../lumifyhub";

export const stackKeys = {
  all: ["stacks"] as const,
  list: () => [...stackKeys.all, "list"] as const,
  preview: (projectId: string) =>
    [...stackKeys.all, "preview", projectId] as const,
};

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useStacksQuery() {
  return useQuery({
    queryKey: stackKeys.list(),
    queryFn: async () =>
      (await call<{ stacks: StackView[] }>("/api/stacks")).stacks,
    refetchInterval: 5000,
  });
}

// The plan a board would run as, before anything starts.
export function useStackPreview(projectId: string | null) {
  return useQuery({
    queryKey: stackKeys.preview(projectId ?? ""),
    queryFn: async () =>
      (
        await call<{ preview: StackPreview }>("/api/stacks", {
          projectId,
          dryRun: true,
        })
      ).preview,
    enabled: !!projectId,
    staleTime: 0,
  });
}

function useStackMutation<V>(fn: (v: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: lumifyhubKeys.todos() });
    },
  });
}

export function useStartStack() {
  return useStackMutation(
    (input: { projectId: string; maxParallel?: number }) =>
      call<{ stack: StackView }>("/api/stacks", input)
  );
}

export type StackAction = "pause" | "resume" | "land" | "tick";

export function useStackAction() {
  return useStackMutation(
    ({ id, action }: { id: string; action: StackAction }) =>
      call(`/api/stacks/${id}/${action}`, {})
  );
}

export function useStackItemAction() {
  return useStackMutation(
    ({
      id,
      itemId,
      action,
    }: {
      id: string;
      itemId: string;
      action: "drop" | "restack" | "retry";
    }) => call(`/api/stacks/${id}/items/${itemId}/${action}`, {})
  );
}
