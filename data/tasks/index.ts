import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaskView } from "@/lib/tasks";
import { sessionKeys } from "../sessions/keys";

export const taskKeys = {
  all: ["tasks"] as const,
  list: () => [...taskKeys.all, "list"] as const,
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useTasksQuery() {
  return useQuery({
    queryKey: taskKeys.list(),
    queryFn: async () =>
      (await json<{ tasks: TaskView[] }>(await fetch("/api/tasks"))).tasks,
    refetchInterval: 5000,
  });
}

function useTaskMutation<V>(fn: (v: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useCreateTask() {
  return useTaskMutation(
    async (input: { projectId: string; prompt: string; model?: string }) =>
      json(
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      )
  );
}

export function useSignOffTask() {
  return useTaskMutation(async (id: string) =>
    json(await fetch(`/api/tasks/${id}/merge`, { method: "POST" }))
  );
}

export function useDropTask() {
  return useTaskMutation(async (id: string) =>
    json(await fetch(`/api/tasks/${id}/drop`, { method: "POST" }))
  );
}
