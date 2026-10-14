import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueuedTaskView, StartOutcome } from "@/lib/tasks/queue";
import {
  priorityRequest,
  queueRequest,
  type QueueMenuAction,
} from "@/lib/sidebar/queued";
import type { Priority } from "@/lib/tasks/schedule-types";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "./keys";
import { usePollWhenOffline } from "../push/connection";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Tasks waiting to start, in line order. A change to the line is pushed
// (the task_queue topic), so it starts or moves here with no reload.
export function useQueuedTasksQuery() {
  return useQuery({
    queryKey: taskKeys.queue(),
    queryFn: async () =>
      (await json<{ queue: QueuedTaskView[] }>(await fetch("/api/tasks/queue")))
        .queue,
    refetchInterval: usePollWhenOffline(15000),
  });
}

export type QueueAction = QueueMenuAction;

// Start now, move up or down, or remove. A refused start (the
// orchestrator's brakes) rejects with the reason.
export function useQueueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: QueueAction }) => {
      const { url, init } = queueRequest(id, action);
      return json<{ outcome?: StartOutcome }>(await fetch(url, init));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

// Changes where a waiting task stands; the line re-ranks from the push.
export function useSetPriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      priority,
    }: {
      id: string;
      priority: Priority;
    }) => {
      const { url, init } = priorityRequest(id, priority);
      return json<unknown>(await fetch(url, init));
    },
    onMutate: async ({ id, priority }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.queue() });
      const previous = queryClient.getQueryData<QueuedTaskView[]>(
        taskKeys.queue()
      );
      queryClient.setQueryData<QueuedTaskView[]>(taskKeys.queue(), (old) =>
        old?.map((q) => (q.id === id ? { ...q, priority } : q))
      );
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous)
        queryClient.setQueryData(taskKeys.queue(), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}
