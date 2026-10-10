import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaskView } from "@/lib/tasks";
import type { QueuedTaskView } from "@/lib/tasks/queue";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "./keys";
import { usePollWhenOffline } from "../push/connection";

export { taskKeys };
export * from "./move";

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
    // Changes to tasks are pushed; a PR's state on GitHub isn't, so it's
    // looked at once a minute (every 15s while the stream is down).
    refetchInterval: usePollWhenOffline(15000) || 60000,
  });
}

function useTaskMutation<V, R = unknown>(fn: (v: V) => Promise<R>) {
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
    async (input: {
      projectId: string;
      prompt: string;
      model?: string;
      baseBranch?: string;
      hostId?: string;
      view?: "chat" | "terminal";
    }) =>
      // Over the workspace's running task limit it's queued instead.
      json<
        | { session: { id: string }; queued?: undefined }
        | { session?: undefined; queued: QueuedTaskView }
      >(
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

export function useResumeTask() {
  return useTaskMutation(async (input: { id: string; force?: boolean }) =>
    json(
      await fetch(`/api/tasks/${input.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: input.force === true }),
      })
    )
  );
}
