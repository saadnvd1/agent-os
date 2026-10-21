"use client";

import { ModeChooser } from "@/components/Report/ModeChooser";
import { useSetWorkspaceMode, useWorkspaceMode } from "@/data/reports";

// A workspace's default operating mode; a task can override it.
export function WorkspaceModeForm({ workspaceId }: { workspaceId: string }) {
  const { data: mode } = useWorkspaceMode(workspaceId);
  const set = useSetWorkspaceMode(workspaceId);
  if (!mode) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-medium">Operating mode</h4>
      <ModeChooser
        mode={mode}
        onChange={(m) => set.mutate(m)}
        disabled={set.isPending}
        note="New tasks start in this mode; any task can change its own."
      />
    </div>
  );
}
