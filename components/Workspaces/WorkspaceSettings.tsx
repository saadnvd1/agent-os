"use client";

import { SettingToggle } from "@/components/Settings/SettingToggle";
import { useUpdateWorkspace, useWorkspacesQuery } from "@/data/workspaces";
import { TaskLimitForm } from "./TaskLimitForm";
import { RulesForm } from "./RulesForm";
import { FreshStartForm } from "./FreshStartForm";
import { McpServersForm } from "./McpServersForm";
import { HqFolderForm } from "./HqFolderForm";
import { ProjectTiersForm } from "./ProjectTiersForm";
import { StallForm } from "./StallForm";
import { WorkspaceModelsForm } from "./WorkspaceModelsForm";
import { AwayWindowForm } from "@/components/Away/AwayWindowForm";

// Settings > Workspaces: each workspace's own settings.
export function WorkspaceSettings() {
  const { data: workspaces, isPending, isError, error } = useWorkspacesQuery();
  const update = useUpdateWorkspace();

  if (isPending)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive text-sm">{error.message}</p>;
  if (!workspaces.length)
    return (
      <p className="text-muted-foreground text-sm">
        No workspaces yet. Make one from the workspace menu at the top of the
        sidebar.
      </p>
    );

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Running task limit: tasks over it wait in the Queued list and start by
        themselves, in order, when a running one finishes.
      </p>
      {workspaces.map((w) => (
        <section
          key={w.id}
          aria-label={w.name}
          className="bg-muted/40 space-y-3 rounded-lg px-3 py-3"
        >
          <h3 className="truncate text-sm font-medium">{w.name}</h3>
          <TaskLimitForm
            key={`${w.id}:${w.max_running_tasks ?? "off"}`}
            workspace={w}
          />
          <RulesForm workspaceId={w.id} />
          <WorkspaceModelsForm workspaceId={w.id} />
          <McpServersForm workspace={w} />
          <HqFolderForm workspaceId={w.id} />
          <ProjectTiersForm workspaceId={w.id} />
          <SettingToggle
            title="Wake tasks on CI failures and reviews"
            detail="A task's agent is messaged once when a check fails on its PR's head, with the log's tail, and when someone reviews or comments on it."
            checked={w.wake_tasks_on_pr}
            onChange={(on) => update.mutate({ id: w.id, wakeTasksOnPR: on })}
          />
          <SettingToggle
            title="Orchestrator full access"
            detail="Its shell and file writes aren't checked: it can push, commit, edit any repository or file on this machine, and merge a PR directly. Off: the deny list, write limits, quick-change cap and merge-only-through-the-gates apply."
            checked={w.orch_full_access}
            onChange={(on) => update.mutate({ id: w.id, orchFullAccess: on })}
          />
        </section>
      ))}
      <FreshStartForm />
      <StallForm />
      <AwayWindowForm />
    </div>
  );
}
