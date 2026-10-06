"use client";

import type { ReactNode } from "react";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import { useWorkspacesQuery } from "@/data/workspaces";
import { WorkspaceHeader } from "./WorkspaceHeader";

interface WorkspaceGroupsProps<P extends ProjectWithDevServers> {
  projects: P[];
  sessions: Session[];
  sessionStatuses?: Record<string, { status: string }>;
  renderProjects: (projects: P[]) => ReactNode;
}

// Projects without a workspace come first, then one collapsible section per
// workspace.
export function WorkspaceGroups<P extends ProjectWithDevServers>({
  projects,
  sessions,
  sessionStatuses,
  renderProjects,
}: WorkspaceGroupsProps<P>) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  const known = new Set(workspaces.map((w) => w.id));
  const ungrouped = projects.filter(
    (p) => !p.workspace_id || !known.has(p.workspace_id)
  );

  const needsYou = (projectIds: Set<string>) =>
    sessions.filter(
      (s) =>
        s.project_id &&
        projectIds.has(s.project_id) &&
        sessionStatuses?.[s.id]?.status === "waiting"
    ).length;
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
        return (
          <div key={workspace.id}>
            <WorkspaceHeader
              workspace={workspace}
              projectCount={members.length}
              needsYou={needsYou(new Set(members.map((p) => p.id)))}
            />
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
