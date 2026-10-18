"use client";

import { SettingToggle } from "@/components/Settings/SettingToggle";
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
    <div className="space-y-2">
      {mine.map((p) => (
        <SettingToggle
          key={p.id}
          title={`${p.name}: production`}
          detail="On: CI, the independent review and scope gate its merges. Off (fast): a task's PR merges as soon as it opens."
          checked={p.tier === "production"}
          onChange={(on) =>
            update.mutate({
              projectId: p.id,
              tier: on ? "production" : "fast",
            })
          }
        />
      ))}
    </div>
  );
}
