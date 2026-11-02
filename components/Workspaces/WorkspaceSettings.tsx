"use client";

import { settingsUiActions } from "@/stores/settingsUi";
import { useUpdateWorkspace, useWorkspacesQuery } from "@/data/workspaces";
import { RulesForm } from "./RulesForm";
import { McpServersForm } from "./McpServersForm";
import { HqFolderForm } from "./HqFolderForm";
import { ProjectTiersForm } from "./ProjectTiersForm";
import { WorkspaceModeForm } from "./WorkspaceModeForm";
import { WorkspaceModelsForm } from "./WorkspaceModelsForm";
import { AppWideLimits } from "@/components/Settings/AppWideLimits";
import {
  NumberSetting,
  SwitchSetting,
} from "@/components/Settings/settings-fields";
import { SettingSection } from "@/components/Settings/SettingRow";
import { SETTING_DEFAULTS } from "@/lib/settings/defaults";

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
          <SettingSection>
            <NumberSetting
              id={`task-limit-${w.id}`}
              label="Tasks at a time"
              help="Cap on tasks running at once. The rest wait in Queued and start in order."
              value={w.max_running_tasks ?? 0}
              defaultValue={0}
              onSave={(n) =>
                update.mutateAsync({
                  id: w.id,
                  maxRunningTasks: n === 0 ? null : n,
                })
              }
              min={1}
              integer
              unit="at a time"
              optional={{ off: 0, on: SETTING_DEFAULTS.taskLimitOn }}
            />
          </SettingSection>
          <WorkspaceModeForm workspaceId={w.id} />
          <RulesForm workspaceId={w.id} />
          <WorkspaceModelsForm workspaceId={w.id} />
          <McpServersForm workspace={w} />
          <HqFolderForm workspaceId={w.id} />
          <ProjectTiersForm workspaceId={w.id} />
          <SettingSection>
            <SwitchSetting
              id={`wake-${w.id}`}
              label="Wake tasks on CI failures and reviews"
              help="A task's agent is messaged once when a check fails on its PR, and when someone reviews or comments."
              checked={w.wake_tasks_on_pr}
              onSave={(on) =>
                update.mutateAsync({ id: w.id, wakeTasksOnPR: on })
              }
            />
            <SwitchSetting
              id={`full-access-${w.id}`}
              label="Orchestrator full access"
              help="Its shell and file writes aren't checked. Applies when its conversation next restarts."
              checked={w.orch_full_access}
              confirm="Let this orchestrator act without approval? It can push, commit, edit any repository or file on this machine, merge a PR directly, and edit .claude files. Off: the deny list, write limits and merge-only-through-the-gates apply."
              confirmLabel="Turn on full access"
              onSave={(on) =>
                update.mutateAsync({ id: w.id, orchFullAccess: on })
              }
            />
          </SettingSection>
        </section>
      ))}
      <AppWideLimits />
      <p className="text-muted-foreground text-sm">
        Fresh starts and compaction are app-wide:{" "}
        <button
          type="button"
          className="text-primary underline-offset-2 hover:underline"
          onClick={() => settingsUiActions.show("context")}
        >
          open Context
        </button>
        .
      </p>
    </div>
  );
}
