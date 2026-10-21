import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OperatingMode,
  ReportResponse,
  ReportSummary,
} from "@/lib/reports/types";

export const reportKeys = {
  all: ["reports"] as const,
  task: (id: string) => [...reportKeys.all, "task", id] as const,
  workspace: (id: string) => [...reportKeys.all, "workspace", id] as const,
  workspaceMode: (id: string) => [...reportKeys.all, "wmode", id] as const,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const GENERATING_POLL_MS = 2000;
const IDLE_POLL_MS = 30_000;

export function useTaskReport(sessionId: string) {
  return useQuery({
    queryKey: reportKeys.task(sessionId),
    queryFn: () => request<ReportResponse>(`/api/tasks/${sessionId}/report`),
    refetchInterval: (q) =>
      q.state.data?.generating ? GENERATING_POLL_MS : IDLE_POLL_MS,
  });
}

export function useGenerateReport(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request(`/api/tasks/${sessionId}/report`, json("POST", {})),
    onSuccess: () => {
      // The next poll sees `generating` and keeps going until it clears.
      qc.setQueryData<ReportResponse>(reportKeys.task(sessionId), (old) =>
        old ? { ...old, generating: true } : old
      );
      qc.invalidateQueries({ queryKey: reportKeys.task(sessionId) });
    },
  });
}

export interface DraftRef {
  source: "report" | "analyst";
  id: string;
  linkId?: string;
}

export function useReportDraft(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: DraftRef & { action: "send" | "dismiss"; text?: string }) =>
      request<ReportResponse>(
        `/api/tasks/${sessionId}/report/draft`,
        json("POST", v)
      ),
    onSuccess: (data) => qc.setQueryData(reportKeys.task(sessionId), data),
  });
}

export function useTaskMode(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: OperatingMode | null) =>
      request(`/api/tasks/${sessionId}/mode`, json("PUT", { mode })),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: reportKeys.task(sessionId) }),
  });
}

export function useWorkspaceMode(workspaceId: string) {
  return useQuery({
    queryKey: reportKeys.workspaceMode(workspaceId),
    queryFn: async () =>
      (
        await request<{ mode: OperatingMode }>(
          `/api/workspaces/${workspaceId}/mode`
        )
      ).mode,
  });
}

export function useSetWorkspaceMode(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: OperatingMode) =>
      request(`/api/workspaces/${workspaceId}/mode`, json("PUT", { mode })),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportKeys.all }),
  });
}

export function useWorkspaceReports(workspaceId: string) {
  return useQuery({
    queryKey: reportKeys.workspace(workspaceId),
    queryFn: async () =>
      (
        await request<{ reports: ReportSummary[] }>(
          `/api/workspaces/${workspaceId}/reports?active=1`
        )
      ).reports,
    refetchInterval: IDLE_POLL_MS,
  });
}
