import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HealthView } from "@/lib/health/view";
import type { NoteRow } from "@/lib/health/notes";
import type { EnvSessionView, EnvSummary } from "@/lib/health/env/types";
import type { Area } from "@/lib/health/types";

export const healthKeys = {
  all: ["health"] as const,
  view: () => [...healthKeys.all, "view"] as const,
  count: () => [...healthKeys.all, "count"] as const,
  notes: () => [...healthKeys.all, "notes"] as const,
  config: () => [...healthKeys.all, "config"] as const,
  env: () => [...healthKeys.all, "env"] as const,
  envSessions: (cls: string) => [...healthKeys.env(), cls] as const,
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

const POLL_MS = 30_000;

export function useHealthQuery() {
  return useQuery({
    queryKey: healthKeys.view(),
    queryFn: () => request<HealthView>("/api/health/anomalies"),
    refetchInterval: POLL_MS,
  });
}

// What the sidebar status dot needs, and nothing more.
export function useHealthCount() {
  return useQuery({
    queryKey: healthKeys.count(),
    queryFn: () =>
      request<{ open: number; needsYou: number }>(
        "/api/health/anomalies?count=1"
      ),
    refetchInterval: POLL_MS,
  });
}

export function useDismissAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request(
        "/api/health/anomalies",
        json("PATCH", { id, action: "dismiss" })
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.all }),
  });
}

export interface NotesResponse {
  seeds: Record<Area, string[]>;
  notes: NoteRow[];
}

export function useHealthNotes() {
  return useQuery({
    queryKey: healthKeys.notes(),
    queryFn: () => request<NotesResponse>("/api/health/notes"),
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note: { area: Area; line: string }) =>
      request("/api/health/notes", json("POST", note)),
    onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.notes() }),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request(`/api/health/notes?id=${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.notes() }),
  });
}

export interface ConfigResponse {
  config: Record<string, number>;
  defaults: Record<string, number>;
  labels: Record<string, string>;
}

export function useHealthConfig() {
  return useQuery({
    queryKey: healthKeys.config(),
    queryFn: () => request<ConfigResponse>("/api/health/config"),
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, number | null>) =>
      request<ConfigResponse>("/api/health/config", json("PUT", { patch })),
    onSuccess: (data) => qc.setQueryData(healthKeys.config(), data),
  });
}

export function useEnvFailures() {
  return useQuery({
    queryKey: healthKeys.env(),
    queryFn: () => request<EnvSummary>("/api/health/env-failures"),
    refetchInterval: POLL_MS,
  });
}

export function useEnvSessions(cls: string, enabled: boolean) {
  return useQuery({
    queryKey: healthKeys.envSessions(cls),
    queryFn: () =>
      request<{ sessions: EnvSessionView[] }>(
        `/api/health/env-failures?class=${encodeURIComponent(cls)}&days=30`
      ),
    enabled,
  });
}

export function useSetEnvFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { class: string; fix: string | null }) =>
      request("/api/health/env-failures", json("PATCH", v)),
    onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.env() }),
  });
}
