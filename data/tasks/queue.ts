import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueuedTaskView, StartOutcome } from "@/lib/tasks/queue";
import { queueRequest, type QueueMenuAction } from "@/lib/sidebar/queued";
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
