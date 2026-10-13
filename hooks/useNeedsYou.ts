"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionsQuery } from "@/data/sessions/queries";
import { useProjectsQuery } from "@/data/projects/queries";
import { fetchStatuses } from "@/data/statuses/queries";
import { statusKeys } from "@/data/sessions/keys";
import { useOrchestratorOverview } from "@/data/orchestrators";
import {
  needsYouItems,
  type NeedsYouItem,
  type TaskNeed,
} from "@/lib/orchestrator/needs-you-items";

// Everything waiting on Saad in a workspace: its open asks and questions, the
// tasks the sidebar marks as needing him, and its chat waiting on an answer.
export function useNeedsYou(
  workspaceId: string,
  chatWaiting: boolean
): NeedsYouItem[] {
  const overview = useOrchestratorOverview(workspaceId);
  const { data: sessions } = useSessionsQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { data: statuses } = useQuery({
    queryKey: statusKeys.all,
    queryFn: fetchStatuses,
    staleTime: 2000,
  });
  const tasks = useMemo(() => {
    const members = new Set(
      projects.filter((p) => p.workspace_id === workspaceId).map((p) => p.id)
    );
    return (sessions?.sessions ?? []).flatMap((s): TaskNeed[] => {
      const need = statuses?.statuses[s.id]?.need;
      return !s.role && s.project_id && members.has(s.project_id) && need
        ? [{ sessionId: s.id, name: s.name, need }]
        : [];
    });
  }, [sessions, projects, statuses, workspaceId]);
  return useMemo(
    () =>
      needsYouItems({
        asks: overview?.asks ?? [],
        questions: overview?.questions ?? [],
        dismissed: overview?.dismissed ?? [],
        tasks,
        chatWaiting,
        chatKey: `approval:${workspaceId}`,
      }),
    [overview, tasks, chatWaiting, workspaceId]
  );
}
