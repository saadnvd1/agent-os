"use client";

import { SettingSection } from "@/components/Settings/SettingRow";
import { SwitchSetting } from "@/components/Settings/settings-fields";
import { useProjectsQuery, useUpdateProject } from "@/data/projects";

// A workspace's projects, each switched between production (every merge gate)
// and fast (a task's PR merges as soon as it opens).
export function ProjectTiersForm({ workspaceId }: { workspaceId: string }) {
  const { data: projects } = useProjectsQuery();
  const update = useUpdateProject();
  const mine = (projects ?? []).filter(
    (p) => p.workspace_id === workspaceId && !p.is_uncategorized
  );
  if (!mine.length) return null;
  return (
    <SettingSection>
      {mine.map((p) => (
        <SwitchSetting
          key={p.id}
          id={`tier-${p.id}`}
          label={`${p.name}: production`}
          help="On: CI, the independent review and scope gate its merges. Off (fast): a task's PR merges as soon as it opens."
          checked={p.tier === "production"}
          onSave={(on) =>
            update.mutateAsync({
              projectId: p.id,
              tier: on ? "production" : "fast",
            })
          }
        />
      ))}
    </SettingSection>
  );
}
