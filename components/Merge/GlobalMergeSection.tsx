"use client";

import {
  useGlobalMergeSettings,
  useUpdateGlobalMergeSettings,
} from "@/data/merge";
import {
  METHOD_LABEL,
  type MergeOverride,
  type MergeSettings,
} from "@/lib/tasks/merge-methods";
import { MergeApprovalToggle } from "./MergeApprovalToggle";
import { MergeSettingsFields } from "./MergeSettingsFields";

// "rebase, keeps worktree"
function describe(s: MergeSettings): string {
  const parts: string[] = [];
  if (s.method) parts.push(METHOD_LABEL[s.method]);
  if (s.delete_remote_branch !== undefined)
    parts.push(
      s.delete_remote_branch ? "deletes origin branch" : "keeps origin branch"
    );
  if (s.delete_worktree !== undefined)
    parts.push(s.delete_worktree ? "deletes worktree" : "keeps worktree");
  return parts.join(", ");
}

function Overrides({ overrides }: { overrides: MergeOverride[] }) {
  if (!overrides.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Projects that override these</p>
      <ul className="bg-muted/40 divide-border divide-y rounded-lg text-sm">
        {overrides.map((o) => (
          <li key={o.projectId} className="space-y-0.5 px-3 py-2">
            <p className="truncate font-medium">{o.name}</p>
            {Object.keys(o.config).length > 0 && (
              <p className="text-muted-foreground text-xs">
                agentos.json: {describe(o.config)}
              </p>
            )}
            {Object.keys(o.project).length > 0 && (
              <p className="text-muted-foreground text-xs">
                Project settings: {describe(o.project)}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        A project&rsquo;s own setting wins over its agentos.json, which wins
        over these. Change a project&rsquo;s in its Project Settings.
      </p>
    </div>
  );
}

// The global merge settings, and the approval gate for sensitive PRs.
export function GlobalMergeSection() {
  const { data, isPending, isError, error } = useGlobalMergeSettings(true);
  const update = useUpdateGlobalMergeSettings();

  return (
    <div className="space-y-5">
      <MergeApprovalToggle />
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          How tasks&rsquo; PRs merge and what&rsquo;s cleaned up after, for
          every project.
        </p>
        {isPending && (
          <div className="bg-muted/40 h-48 animate-pulse rounded-lg" />
        )}
        {isError && <p className="text-destructive text-sm">{error.message}</p>}
        {data && (
          <MergeSettingsFields
            settings={data.settings}
            inherited={data.defaults}
            disabled={update.isPending}
            onChange={(s) => update.mutate(s)}
          />
        )}
        {update.isError && (
          <p className="text-destructive text-sm">{update.error.message}</p>
        )}
      </div>
      {data && <Overrides overrides={data.overrides} />}
    </div>
  );
}
