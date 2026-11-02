"use client";

import {
  useProjectMergeSettings,
  useUpdateProjectMergeSettings,
} from "@/data/merge";
import { MergeSettingsFields } from "./MergeSettingsFields";
import { ProjectSweepSection } from "./WorktreeSweepSection";

// A project's own merge settings, saved as they change. Unset ones inherit
// from agentos.json, then the global settings.
export function ProjectMergeSection({
  projectId,
  open,
}: {
  projectId: string;
  open: boolean;
}) {
  const { data, isPending, isError, error } = useProjectMergeSettings(
    projectId,
    open
  );
  const update = useUpdateProjectMergeSettings(projectId);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Merging</h3>
      {isPending && (
        <div className="bg-muted/40 h-40 animate-pulse rounded-lg" />
      )}
      {isError && <p className="text-destructive text-sm">{error.message}</p>}
      {data && (
        <MergeSettingsFields
          settings={data.settings}
          inherited={data.inherited}
          from={data.inherited.from}
          allowed={data.allowed}
          idPrefix={`merge-${projectId}`}
          onSave={(s) => update.mutateAsync(s)}
        />
      )}
      <ProjectSweepSection projectId={projectId} />
    </div>
  );
}
