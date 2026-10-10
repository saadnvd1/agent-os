"use client";

import {
  useProjectMergeSettings,
  useUpdateProjectMergeSettings,
} from "@/data/merge";
import { MergeSettingsFields } from "./MergeSettingsFields";

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
          disabled={update.isPending}
          onChange={(s) => update.mutate(s)}
        />
      )}
      {update.isError && (
        <p className="text-destructive text-sm">{update.error.message}</p>
      )}
      <p className="text-muted-foreground text-xs">Saved as you change them.</p>
    </div>
  );
}
