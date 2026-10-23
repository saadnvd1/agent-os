"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSnapshot } from "valtio";
import type { Session } from "@/lib/db";
import type { SessionGroup } from "@/lib/sidebar/shelves";
import {
  buildShelves,
  inWorkspace,
  orderGroups,
  projectsInWorkspace,
} from "@/lib/sidebar/shelves";
import type { TaskState } from "@/lib/tasks/state";
import {
  inMachineScope,
  machineGroups,
  onMachineOnly,
} from "@/lib/sidebar/machines";
import { orchestratorsToStart } from "@/lib/sidebar/orchestrator-row";
import { useSessionsQuery } from "@/data/sessions";
import { useLinkedHostNames } from "@/data/hosts";
import { useProjectsQuery } from "@/data/projects";
import { useQueuedTasksQuery, useTasksQuery } from "@/data/tasks";
import { rollups, type Rollup } from "@/lib/sidebar/rollup";
import { queuedRows } from "@/lib/sidebar/queued";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { useClock } from "@/hooks/useMinuteTick";
import { sidebarUi } from "@/stores/sidebarUi";
import { machinesUi, machinesUiActions } from "@/stores/machines";
import type { SessionStatus } from "./SessionList.types";

// One empty list for queries still loading, so memos below hold.
const NONE: never[] = [];
const NONE_GROUPS: SessionGroup[] = [];

// Everything the flat list needs: the current workspace's sessions, sorted
// onto shelves by the remembered filters.
export function useSidebarData(
  sessionStatuses: Record<string, SessionStatus> | undefined
) {
  const ui = useSnapshot(sidebarUi);
  const scope = useSnapshot(machinesUi).scopeHostId;
  useEffect(() => {
    machinesUiActions.hydrate();
  }, []);
  // Wakes and 3-day settles are read from the clock.
  const now = useClock();

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
  const allGroups = sessionsQuery.data?.sessionGroups ?? NONE_GROUPS;
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

  const { all, shelves, machines } = useMemo(() => {
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
      now,
    };
    const input = {
      ...common,
      sessions: sessions.filter(
        (s) =>
          !onMachineOnly(s, linked) &&
          inMachineScope(s, scope) &&
          inWorkspace(
            s,
            (id) => byId.get(id)?.workspace_id,
            workspace?.id ?? null
          )
      ),
      projectId: project?.id ?? null,
      currentOrchestrators,
      groups: orderGroups(
        allGroups.filter((g) => !workspace || g.workspace_id === workspace.id),
        workspaces.map((w) => w.id)
      ),
    };
    // The rollups count the whole list; the filter only narrows what shows.
    const all = buildShelves(input);
    return {
      all,
      shelves: ui.orchestratorId
        ? buildShelves({ ...input, startedBy: ui.orchestratorId })
        : all,
      // Not in any project, nor started by an orchestrator.
      machines:
        project || ui.orchestratorId
          ? []
          : machineGroups(
              { ...common, sessions },
              scope
                ? Object.fromEntries(
                    Object.entries(linked).filter(([id]) => id === scope)
                  )
                : linked
            ),
    };
  }, [
    now,
    linked,
    sessions,
    allGroups,
    projects,
    workspaces,
    tasks,
    currentOrchestrators,
    sessionStatuses,
    workspace,
    project,
    ui.query,
    ui.orchestratorId,
    scope,
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

  // Per workspace, how many tasks wait in its line: they keep its
  // orchestrator row Waiting. Keyed by its counts, like the running ones.
  const queuedKey = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of queue)
      if (item.status === "queued" && item.workspaceId)
        counts.set(item.workspaceId, (counts.get(item.workspaceId) ?? 0) + 1);
    return JSON.stringify([...counts].sort());
  }, [queue]);
  const queuedByWorkspace = useMemo(
    () => new Map<string, number>(JSON.parse(queuedKey)),
    [queuedKey]
  );

  // Tasks waiting to start, in their line's order.
  const queuedAll = useMemo(
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
  const queued = useMemo(
    () =>
      ui.orchestratorId
        ? queuedAll.filter((r) => r.item.startedBy === ui.orchestratorId)
        : queuedAll,
    [queuedAll, ui.orchestratorId]
  );

  // Each orchestrator's started work, keyed by its counts like the ones
  // above so a push that changed none of them redraws no row.
  const rollupKey = useMemo(
    () => JSON.stringify([...rollups(all, queuedAll)].sort()),
    [all, queuedAll]
  );
  const rollupByOrchestrator = useMemo(
    () => new Map(JSON.parse(rollupKey) as [string, Rollup][]),
    [rollupKey]
  );

  // Orchestrator session id -> the workspace it serves, for tags and chips.
  const orchestratorKey = JSON.stringify(
    sessions
      .filter((s) => s.role === "orchestrator")
      .map((s) => [
        s.id,
        workspaces.find((w) => w.id === s.workspace_id)?.name ?? s.name,
      ])
      .sort()
  );
  const orchestratorNames = useMemo(
    () => new Map(JSON.parse(orchestratorKey) as [string, string][]),
    [orchestratorKey]
  );

  const taskCardUrl = useCallback(
    (id: string) => tasks.find((t) => t.id === id)?.cardUrl,
    [tasks]
  );

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const toStart = useMemo(
    () =>
      orchestratorsToStart(orchestrators, {
        workspaces,
        workspaceId: workspace?.id ?? null,
        projectId: project?.id ?? null,
        query: ui.query,
      }),
    [orchestrators, workspaces, workspace, project, ui.query]
  );

  return {
    ui,
    shelves,
    groups: allGroups,
    queued,
    toStart,
    machines,
    sessions,
    projects,
    projectNames,
    runningByWorkspace,
    queuedByWorkspace,
    rollupByOrchestrator,
    orchestratorNames,
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
