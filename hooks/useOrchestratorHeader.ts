"use client";

import { useQuery } from "@tanstack/react-query";
import { useSessionsQuery } from "@/data/sessions/queries";
import { useProjectsQuery } from "@/data/projects/queries";
import { fetchStatuses } from "@/data/statuses/queries";
import { statusKeys } from "@/data/sessions/keys";
import { useOrchestratorOverview } from "@/data/orchestrators";
import type { HeaderCounts } from "@/lib/orchestrator/header-line";

// Sessions working in the workspace's projects, from the same live statuses
// the sidebar's dots show.
export function useWorkspaceRunning(workspaceId: string): number {
  const { data: sessions } = useSessionsQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { data: statuses } = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
  });
  const members = new Set(
    projects.filter((p) => p.workspace_id === workspaceId).map((p) => p.id)
  );
  return (sessions?.sessions ?? []).filter(
    (s) =>
      !s.role &&
      s.project_id &&
      members.has(s.project_id) &&
      statuses?.statuses[s.id]?.status === "running"
  ).length;
}

export function useOrchestratorHeader(workspaceId: string) {
  const overview = useOrchestratorOverview(workspaceId);
  const running = useWorkspaceRunning(workspaceId);
  const counts: HeaderCounts = {
    running,
    inReview: overview?.inReview ?? 0,
    asks: overview?.asks.length ?? 0,
    paused: overview?.paused ?? false,
  };
  return { overview, counts };
}
