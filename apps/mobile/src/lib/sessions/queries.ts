import { useQuery } from "@tanstack/react-query";
import type { Project, Session, Workspace } from "@/lib/db/types";
import type { TaskState } from "@/lib/tasks/state";
import { api } from "~/lib/api/client";
import { keys } from "~/lib/api/keys";
import type { Machine } from "~/lib/machines/store";

const machineKey = (m: Machine | null) => m?.id ?? "none";

export function useSessions(machine: Machine | null) {
  return useQuery({
    queryKey: keys.sessions(machineKey(machine)),
    queryFn: () => api<{ sessions: Session[] }>(machine!, "/api/sessions"),
    select: (d) => d.sessions,
    enabled: !!machine,
    refetchInterval: 10000,
  });
}

export function useProjects(machine: Machine | null) {
  return useQuery({
    queryKey: keys.projects(machineKey(machine)),
    queryFn: () => api<{ projects: Project[] }>(machine!, "/api/projects"),
    select: (d) => d.projects,
    enabled: !!machine,
    staleTime: 60000,
  });
}

export function useWorkspaces(machine: Machine | null) {
  return useQuery({
    queryKey: keys.workspaces(machineKey(machine)),
    queryFn: () =>
      api<{ workspaces: Workspace[] }>(machine!, "/api/workspaces"),
    select: (d) => d.workspaces,
    enabled: !!machine,
    staleTime: 60000,
  });
}

export function useTaskStates(machine: Machine | null) {
  return useQuery({
    queryKey: keys.tasks(machineKey(machine)),
    queryFn: () =>
      api<{ tasks: { id: string; state: TaskState }[] }>(
        machine!,
        "/api/tasks"
      ),
    select: (d) =>
      Object.fromEntries(d.tasks.map((t) => [t.id, t.state])) as Record<
        string,
        TaskState | undefined
      >,
    enabled: !!machine,
    refetchInterval: 30000,
  });
}

export function usePreview(machine: Machine | null, id: string) {
  return useQuery({
    queryKey: keys.preview(machineKey(machine), id),
    queryFn: () =>
      api<{ lines: string[] }>(machine!, `/api/sessions/${id}/preview`),
    select: (d) => d.lines,
    enabled: !!machine,
    refetchInterval: 2000,
  });
}
