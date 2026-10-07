"use client";

import { useEffect, useMemo } from "react";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import { buildShelves, inWorkspace } from "@/lib/sidebar/shelves";
import type { TaskState } from "@/lib/tasks/state";
import { useSessionsQuery } from "@/data/sessions";
import { useProjectsQuery } from "@/data/projects";
import { useTasksQuery } from "@/data/tasks";
import { useWorkspacesQuery } from "@/data/workspaces";
import { sidebarUi, sidebarUiActions } from "@/stores/sidebarUi";
import type { SessionStatus } from "./SessionList.types";

// Everything the flat list needs: the current workspace's sessions, sorted
// onto shelves by the remembered filters.
export function useSidebarData(
  sessionStatuses: Record<string, SessionStatus> | undefined
) {
  const ui = useSnapshot(sidebarUi);
  useEffect(() => sidebarUiActions.hydrate(), []);

  const sessionsQuery = useSessionsQuery();
  const projectsQuery = useProjectsQuery();
  const { data: workspaces = [] } = useWorkspacesQuery();
  const { data: tasks = [] } = useTasksQuery();

  const sessions = useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data]
  );
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data]
  );

  // A remembered workspace or project that no longer exists is "all".
  const workspace = workspaces.find((w) => w.id === ui.workspaceId) ?? null;
  const workspaceProjects = projects.filter(
    (p) => !workspace || p.workspace_id === workspace.id
  );
  const project = workspaceProjects.find((p) => p.id === ui.projectId) ?? null;

  const shelves = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
    const taskStates: Record<string, TaskState> = {};
    for (const t of tasks) taskStates[t.id] = t.state;
    const projectName = (s: Session) =>
      s.role === "orchestrator"
        ? `Orchestrator · ${workspaceName.get(s.workspace_id ?? "") ?? ""}`
        : (byId.get(s.project_id ?? "")?.name ?? "");
    return buildShelves({
      sessions: sessions.filter((s) =>
        inWorkspace(
          s,
          (id) => byId.get(id)?.workspace_id,
          workspace?.id ?? null
        )
      ),
      statuses: sessionStatuses ?? {},
      tasks: taskStates,
      projectName,
      query: ui.query,
      projectId: project?.id ?? null,
    });
  }, [
    sessions,
    projects,
    workspaces,
    tasks,
    sessionStatuses,
    workspace,
    project,
    ui.query,
  ]);

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  return {
    ui,
    shelves,
    sessions,
    projects,
    projectNames,
    workspaces,
    workspace,
    workspaceProjects,
    project,
    taskCardUrl: (id: string) => tasks.find((t) => t.id === id)?.cardUrl,
    isPending: sessionsQuery.isPending || projectsQuery.isPending,
    error: sessionsQuery.error ?? projectsQuery.error,
    refetch: () => {
      void sessionsQuery.refetch();
      void projectsQuery.refetch();
    },
  };
}

export type SidebarData = ReturnType<typeof useSidebarData>;
