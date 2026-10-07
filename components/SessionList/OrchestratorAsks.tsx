"use client";

import { AsksList } from "@/components/Orchestrator/AsksList";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { useRowContext } from "./RowContext";

// An orchestrator's first open asks, answerable right from the sidebar.
export function OrchestratorAsks({
  workspaceId,
}: {
  workspaceId: string | null;
}) {
  const { orchestrators } = useRowContext();
  const asks =
    orchestrators.find((o) => o.workspaceId === workspaceId)?.asks ?? [];
  if (!workspaceId || asks.length === 0) return null;
  return (
    <div className="pt-1 pr-1 pb-2 pl-7">
      <AsksList
        workspaceId={workspaceId}
        asks={asks}
        limit={1}
        onMore={() => orchestratorOpenActions.request(workspaceId)}
      />
    </div>
  );
}
