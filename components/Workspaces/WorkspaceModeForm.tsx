"use client";

import { SettingBlock } from "@/components/Settings/SettingRow";
import { ModeChooser } from "@/components/Report/ModeChooser";
import { useSetWorkspaceMode, useWorkspaceMode } from "@/data/reports";

// A workspace's default operating mode; a task can override it.
export function WorkspaceModeForm({ workspaceId }: { workspaceId: string }) {
  const { data: mode } = useWorkspaceMode(workspaceId);
  const set = useSetWorkspaceMode(workspaceId);
  if (!mode) return null;
  return (
    <SettingBlock id={`mode-${workspaceId}`} label="Operating mode">
      <ModeChooser
        mode={mode}
        onChange={(m) => set.mutate(m)}
        disabled={set.isPending}
        note="New tasks start in this mode; any task can change its own."
      />
    </SettingBlock>
  );
}
