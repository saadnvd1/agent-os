"use client";

import { useContext, useState } from "react";
import { settingsUiActions } from "@/stores/settingsUi";
import { useWorkspacesQuery } from "@/data/workspaces";
import { useProjectsQuery } from "@/data/projects";
import { AppWideLimits } from "@/components/Settings/AppWideLimits";
import {
  matchesQuery,
  SettingsQueryContext,
} from "@/components/Settings/SettingRow";
import { WorkspacePanel } from "./WorkspacePanel";
import { WorkspacePicker } from "./WorkspacePicker";
import { useSettingsWorkspace } from "./useSettingsWorkspace";

// What every workspace's page has, for the search box to find.
const SHARED_ROWS =
  "tasks at a time limit operating mode orchestrator full access wake ci failures reviews models hq folder session logs rules mcp servers projects production fast merge tier";

// Settings > Workspaces: one workspace's settings at a time.
export function WorkspaceSettings() {
  const { data: workspaces, isPending, isError, error } = useWorkspacesQuery();
  const { data: projects } = useProjectsQuery();
  const query = useContext(SettingsQueryContext);
  const { current, choose } = useSettingsWorkspace(workspaces ?? []);
  // The search a hand-picked workspace overrides.
  const [pinnedFor, setPinnedFor] = useState<string | null>(null);

  // A search that matches only another workspace (its name, a project) shows
  // that workspace; the shared rows are on every page, so they never move it.
  const searchHit =
    query.trim() &&
    workspaces &&
    current &&
    pinnedFor !== query &&
    !matchesQuery(query, SHARED_ROWS)
      ? workspaces.find((w) =>
          matchesQuery(
            query,
            w.name,
            ...(projects ?? [])
              .filter((p) => p.workspace_id === w.id)
              .map((p) => p.name)
          )
        )
      : undefined;

  if (isPending)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  if (!workspaces.length || !current)
    return (
      <p className="text-muted-foreground text-sm">
        No workspaces yet. Make one from the workspace menu at the top of the
        sidebar.
      </p>
    );

  const shown = searchHit ?? current;
  return (
    <div>
      <WorkspacePicker
        workspaces={workspaces}
        value={shown.id}
        onChange={(id) => {
          setPinnedFor(query);
          choose(id);
        }}
      />
      <WorkspacePanel key={shown.id} workspace={shown} />
      <AppWideLimits />
      <p className="text-muted-foreground text-sm">
        Fresh starts and compaction are app-wide:{" "}
        <button
          type="button"
          className="text-primary -my-3 min-h-11 underline-offset-2 hover:underline"
          onClick={() => settingsUiActions.show("context")}
        >
          open Context
        </button>
        .
      </p>
    </div>
  );
}
