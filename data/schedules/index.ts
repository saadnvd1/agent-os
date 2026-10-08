import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ScheduleInput, ScheduleRun, ScheduleView } from "@/lib/schedules";
import type { RunResult } from "@/lib/schedules/run";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "../tasks";
import { usePollWhenOffline } from "../push/connection";

export const scheduleKeys = {
  all: ["schedules"] as const,
  list: (workspaceId: string | null) =>
    [...scheduleKeys.all, "list", workspaceId ?? "all"] as const,
  detail: (id: string) => [...scheduleKeys.all, "detail", id] as const,
};

async function call<T>(
  url: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useSchedulesQuery(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: scheduleKeys.list(workspaceId),
    queryFn: async () =>
      (
        await call<{ schedules: ScheduleView[] }>(
          `/api/schedules${workspaceId ? `?workspace=${workspaceId}` : ""}`
        )
      ).schedules,
    enabled,
    // Pushed when schedules or their runs change.
    refetchInterval: usePollWhenOffline(15000),
  });
}

export function useScheduleQuery(id: string | null) {
  return useQuery({
    queryKey: scheduleKeys.detail(id ?? ""),
    queryFn: () =>
      call<{ schedule: ScheduleView; runs: ScheduleRun[] }>(
        `/api/schedules/${id}`
      ),
    enabled: !!id,
    refetchInterval: usePollWhenOffline(10000),
  });
}

function useScheduleMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useCreateSchedule() {
  return useScheduleMutation((input: ScheduleInput) =>
    call<{ schedule: ScheduleView }>("/api/schedules", "POST", input)
  );
}

export function useUpdateSchedule() {
  return useScheduleMutation(
    ({ id, ...patch }: Partial<ScheduleInput> & { id: string }) =>
      call<{ schedule: ScheduleView }>(`/api/schedules/${id}`, "PATCH", patch)
  );
}

export function useArchiveSchedule() {
  return useScheduleMutation((id: string) =>
    call(`/api/schedules/${id}`, "DELETE")
  );
}

export function useRunSchedule() {
  return useScheduleMutation((id: string) =>
    call<{ run: RunResult }>(`/api/schedules/${id}/run`, "POST", {})
  );
}
