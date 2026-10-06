"use client";

import type { ReactNode } from "react";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import { useWorkspacesQuery } from "@/data/workspaces";
import type { SessionStatus } from "@/components/SessionList/SessionList.types";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { OrchestratorRow } from "./OrchestratorRow";
import { useOrchestratorsQuery } from "@/data/orchestrators";
import { needCount } from "@/lib/orchestrator/header-line";
import { AsksList } from "@/components/Orchestrator/AsksList";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";

interface WorkspaceGroupsProps<P extends ProjectWithDevServers> {
  projects: P[];
  // Every session, the workspaces' orchestrators included.
  sessions: Session[];
  sessionStatuses?: Record<string, SessionStatus>;
  activeSessionId?: string;
  onSelect: (sessionId: string) => void;
  renderProjects: (projects: P[]) => ReactNode;
}

// Projects without a workspace come first, then one collapsible section per
// workspace.
export function WorkspaceGroups<P extends ProjectWithDevServers>({
  projects,
  sessions,
  sessionStatuses,
  activeSessionId,
  onSelect,
  renderProjects,
}: WorkspaceGroupsProps<P>) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  const { data: orchestrators = [] } = useOrchestratorsQuery();
  const known = new Set(workspaces.map((w) => w.id));
  const ungrouped = projects.filter(
    (p) => !p.workspace_id || !known.has(p.workspace_id)
  );

  const inProjects = (projectIds: Set<string>, status: string) =>
    sessions.filter(
      (s) =>
        !s.role &&
        s.project_id &&
        projectIds.has(s.project_id) &&
        sessionStatuses?.[s.id]?.status === status
    ).length;
  const needsYou = (projectIds: Set<string>) =>
    inProjects(projectIds, "waiting");
  // Projects waiting on you come first; the rest keep their order.
  const urgentFirst = (list: P[]) =>
    [...list].sort(
      (a, b) =>
        Number(needsYou(new Set([b.id])) > 0) -
        Number(needsYou(new Set([a.id])) > 0)
    );

  return (
    <>
      {ungrouped.length > 0 && renderProjects(urgentFirst(ungrouped))}
      {workspaces.map((workspace) => {
        const members = projects.filter((p) => p.workspace_id === workspace.id);
        const orchestrator = sessions.find(
          (s) => s.role === "orchestrator" && s.workspace_id === workspace.id
        );
        const orchStatus = orchestrator
          ? sessionStatuses?.[orchestrator.id]
          : undefined;
        const memberIds = new Set(members.map((p) => p.id));
        const overview = orchestrators.find(
          (o) => o.workspaceId === workspace.id
        );
        const asks = overview?.asks ?? [];
        const open = () =>
          orchestrator
            ? onSelect(orchestrator.id)
            : orchestratorOpenActions.request(workspace.id);
        return (
          <div key={workspace.id}>
            <WorkspaceHeader
              workspace={workspace}
              projectCount={members.length}
              needsYou={needsYou(memberIds) + needCount(orchStatus)}
              paused={!!overview?.paused}
            />
            {!workspace.collapsed && (
              <OrchestratorRow
                workspaceId={workspace.id}
                session={orchestrator}
                status={orchStatus}
                active={!!orchestrator && orchestrator.id === activeSessionId}
                onSelect={onSelect}
                counts={{
                  running: inProjects(memberIds, "running"),
                  inReview: overview?.inReview ?? 0,
                  asks: asks.length,
                  paused: !!overview?.paused,
                }}
              />
            )}
            {!workspace.collapsed && asks.length > 0 && (
              <div className="pt-1 pr-1 pb-2 pl-9">
                <AsksList
                  workspaceId={workspace.id}
                  asks={asks}
                  limit={2}
                  onMore={open}
                />
              </div>
            )}
            {!workspace.collapsed &&
              (members.length > 0 ? (
                renderProjects(urgentFirst(members))
              ) : (
                <p className="text-muted-foreground/60 px-2 py-1 text-xs">
                  Move projects here from their ⋯ menu
                </p>
              ))}
          </div>
        );
      })}
    </>
  );
}
