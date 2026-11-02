"use client";

import { PickerSetting } from "@/components/Settings/PickerSetting";
import { SettingSection } from "@/components/Settings/SettingRow";
import { Segmented } from "@/components/ui/segmented";
import { useProjectsQuery, useUpdateProject } from "@/data/projects";

type Tier = "production" | "fast";

const TIERS: { value: Tier; label: string }[] = [
  { value: "production", label: "Production" },
  { value: "fast", label: "Fast" },
];

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
    <SettingSection
      title="Projects"
      help="Production: CI, the independent review and the scope gate every merge. Fast: a task's PR merges as soon as it opens."
    >
      {mine.map((p) => (
        <PickerSetting<Tier>
          key={p.id}
          id={`tier-${p.id}`}
          label={p.name}
          value={p.tier === "production" ? "production" : "fast"}
          onSave={(tier) => update.mutateAsync({ projectId: p.id, tier })}
          render={({ value, commit }) => (
            <Segmented
              label={`${p.name} merge tier`}
              value={value}
              options={TIERS}
              onChange={commit}
            />
          )}
        />
      ))}
    </SettingSection>
  );
}
