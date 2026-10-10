"use client";

import { useCallback, useMemo } from "react";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import {
  buildShelves,
  inWorkspace,
  projectsInWorkspace,
} from "@/lib/sidebar/shelves";
import type { TaskState } from "@/lib/tasks/state";
import { machineGroups, onMachineOnly } from "@/lib/sidebar/machines";
import { useSessionsQuery } from "@/data/sessions";
import { useLinkedHostNames } from "@/data/hosts";
import { useProjectsQuery } from "@/data/projects";
import { useQueuedTasksQuery, useTasksQuery } from "@/data/tasks";
import { queuedRows } from "@/lib/sidebar/queued";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { sidebarUi } from "@/stores/sidebarUi";
import type { SessionStatus } from "./SessionList.types";

// One empty list for queries still loading, so memos below hold.
const NONE: never[] = [];

// Everything the flat list needs: the current workspace's sessions, sorted
// onto shelves by the remembered filters.
export function useSidebarData(
  sessionStatuses: Record<string, SessionStatus> | undefined
) {
  const ui = useSnapshot(sidebarUi);

  const sessionsQuery = useSessionsQuery();
  const projectsQuery = useProjectsQuery();
  const { workspaces, workspace } = useSelectedWorkspace();
  const { data: tasks = NONE } = useTasksQuery();
  const { data: orchestrators = NONE } = useOrchestratorsQuery();
  const { data: queue = NONE } = useQueuedTasksQuery();
  // Keyed by the ids, so an asks push doesn't re-sort the shelves.
  const currentKey = orchestrators
    .flatMap((o) => (o.sessionId ? [o.sessionId] : []))
    .sort()
    .join(",");
  const currentOrchestrators = useMemo(
    () => new Set(currentKey ? currentKey.split(",") : []),
    [currentKey]
  );

  const sessions = useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data]
  );
  // Keyed by its contents: the hosts query hands back a new object each time.
  const linkedKey = JSON.stringify(useLinkedHostNames());
  const linked = useMemo(
    () => JSON.parse(linkedKey) as Record<string, string>,
    [linkedKey]
  );
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data]
  );

  // A remembered project that no longer exists is "all".
  const workspaceProjects = projectsInWorkspace(
    projects,
    workspace?.id ?? null
  );
  const project = workspaceProjects.find((p) => p.id === ui.projectId) ?? null;

  const { shelves, machines } = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
    const taskStates: Record<string, TaskState> = {};
    for (const t of tasks) taskStates[t.id] = t.state;
    const projectName = (s: Session) =>
      s.role === "orchestrator"
        ? `Orchestrator · ${workspaceName.get(s.workspace_id ?? "") ?? ""}`
        : (byId.get(s.project_id ?? "")?.name ?? "");
    const common = {
      statuses: sessionStatuses ?? {},
      tasks: taskStates,
      projectName,
      query: ui.query,
    };
    return {
      shelves: buildShelves({
        ...common,
        sessions: sessions.filter(
          (s) =>
            !onMachineOnly(s, linked) &&
            inWorkspace(
              s,
              (id) => byId.get(id)?.workspace_id,
              workspace?.id ?? null
            )
        ),
        projectId: project?.id ?? null,
        currentOrchestrators,
      }),
      // Not in any project, so not under a chosen one.
      machines: project ? [] : machineGroups({ ...common, sessions }, linked),
    };
  }, [
    linked,
    sessions,
    projects,
    workspaces,
    tasks,
    currentOrchestrators,
    sessionStatuses,
    workspace,
    project,
    ui.query,
  ]);

  // Per workspace, how many of its project sessions are working: the
  // orchestrator row's "3 running".
  // Keyed by its counts, so the same counts keep the same map and rows
  // don't redraw for a push that changed nothing they show.
  const runningKey = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.workspace_id]));
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const ws = byId.get(s.project_id ?? "");
      if (s.role || !ws || sessionStatuses?.[s.id]?.status !== "running")
        continue;
      counts.set(ws, (counts.get(ws) ?? 0) + 1);
    }
    return JSON.stringify([...counts].sort());
  }, [sessions, projects, sessionStatuses]);
  const runningByWorkspace = useMemo(
    () => new Map<string, number>(JSON.parse(runningKey)),
    [runningKey]
  );

  // Tasks waiting to start, in their line's order.
  const queued = useMemo(
    () =>
      queuedRows({
        queue,
        sessionIds: new Set(sessions.map((s) => s.id)),
        workspaceId: workspace?.id ?? null,
        projectId: project?.id ?? null,
        query: ui.query,
      }),
    [queue, sessions, workspace, project, ui.query]
  );

  const taskCardUrl = useCallback(
    (id: string) => tasks.find((t) => t.id === id)?.cardUrl,
    [tasks]
  );

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  return {
    ui,
    shelves,
    queued,
    machines,
    sessions,
    projects,
    projectNames,
    runningByWorkspace,
    workspaces,
    workspace,
    workspaceProjects,
    project,
    taskCardUrl,
    isPending: sessionsQuery.isPending || projectsQuery.isPending,
    error: sessionsQuery.error ?? projectsQuery.error,
    refetch: () => {
      void sessionsQuery.refetch();
      void projectsQuery.refetch();
    },
  };
}

export type SidebarData = ReturnType<typeof useSidebarData>;
